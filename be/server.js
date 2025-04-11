const express = require('express');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Subscription = require('./models/Subscription');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const COINBASE_WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const PRODUCTS = ['BTC-USD', 'ETH-USD', 'XRP-USD', 'LTC-USD'];

const orderBooks = new Map();
const matches = new Map();
const clients = new Map();
let activeSubscriptions = new Set();

// MongoDB Connection with Retry Logic
const connectWithRetry = async () => {
  let retries = 5;
  while (retries) {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/coinbase_pro', {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });
      console.log('MongoDB connected successfully');
      return true;
    } catch (err) {
      console.error(`MongoDB connection failed (${retries} retries left):`, err.message);
      retries -= 1;
      if (retries === 0) {
        console.error('Max retries reached. Falling back to in-memory storage.');
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

// Initialize Coinbase WebSocket
let coinbaseWs;

const initializeWebSocket = () => {
  coinbaseWs = new WebSocket(COINBASE_WS_URL);

  coinbaseWs.on('open', () => {
    console.log('Connected to Coinbase WebSocket');
    if (activeSubscriptions.size > 0) {
      const subscribeMessage = JSON.stringify({
        type: 'subscribe',
        product_ids: Array.from(activeSubscriptions),
        channels: ['level2', 'matches'],
      });
      console.log('Sending subscription:', subscribeMessage);
      coinbaseWs.send(subscribeMessage);
    }
  });

  coinbaseWs.on('message', (data) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'snapshot':
        orderBooks.set(msg.product_id, { bids: msg.bids || [], asks: msg.asks || [] });
        broadcastToSubscribed(msg.product_id, 'price', orderBooks.get(msg.product_id));
        break;
      case 'l2update':
        if (orderBooks.has(msg.product_id)) {
          updateOrderBook(msg);
          broadcastToSubscribed(msg.product_id, 'price', orderBooks.get(msg.product_id));
        }
        break;
      case 'match':
        if (!matches.has(msg.product_id)) matches.set(msg.product_id, []);
        matches.get(msg.product_id).unshift(msg);
        if (matches.get(msg.product_id).length > 50) matches.get(msg.product_id).pop();
        broadcastToSubscribed(msg.product_id, 'match', msg);
        break;
      case 'subscriptions':
        broadcastToAll('channels', msg.channels);
        break;
      case 'error':
        console.error('Coinbase WebSocket Error:', msg.message);
        break;
    }
  });

  coinbaseWs.on('close', () => {
    console.log('Coinbase WebSocket closed, reconnecting...');
    setTimeout(initializeWebSocket, 2000);
  });

  coinbaseWs.on('error', (error) => console.error('Coinbase WebSocket Error:', error.message));
};

// Update Order Book
function updateOrderBook(update) {
  const book = orderBooks.get(update.product_id);
  update.changes.forEach(([side, price, size]) => {
    const bookSide = side === 'buy' ? book.bids : book.asks;
    const index = bookSide.findIndex(([p]) => p === price);
    if (size === '0' && index !== -1) bookSide.splice(index, 1);
    else if (index !== -1) bookSide[index] = [price, size];
    else bookSide.push([price, size]);
  });
}

// Broadcast Functions
function broadcastToSubscribed(product, type, data) {
  clients.forEach(({ userId, subscriptions }, ws) => {
    if (subscriptions.includes(product) && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, product, data }));
    }
  });
}

function broadcastToAll(type, data) {
  clients.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  });
}

// WebSocket Client Handling
wss.on('connection', async (ws) => {
  const userId = uuidv4();
  let subscriptions = [];
  const dbConnected = mongoose.connection.readyState === 1;

  if (dbConnected) {
    try {
      let subDoc = await Subscription.findOne({ userId });
      if (!subDoc) {
        subDoc = await Subscription.create({ userId, products: [] });
      }
      subscriptions = subDoc.products;
    } catch (err) {
      console.error(`Error loading subscriptions for user ${userId}:`, err.message);
    }
  }

  clients.set(ws, { userId, subscriptions });
  ws.send(JSON.stringify({ type: 'userId', userId }));
  ws.send(JSON.stringify({ type: 'subscriptions', products: subscriptions }));
  console.log(`User ${userId} connected`);

  ws.on('message', async (message) => {
    let { action, product } = JSON.parse(message);
    if (!PRODUCTS.includes(product)) return;

    let clientData = clients.get(ws);
    let updatedSubscriptions = [...clientData.subscriptions];

    if (action === 'subscribe' && !updatedSubscriptions.includes(product)) {
      updatedSubscriptions.push(product);
      activeSubscriptions.add(product);
      if (coinbaseWs.readyState === WebSocket.OPEN) {
        coinbaseWs.send(JSON.stringify({
          type: 'subscribe',
          product_ids: [product],
          channels: ['level2', 'matches'],
        }));
      }
    } else if (action === 'unsubscribe' && updatedSubscriptions.includes(product)) {
      updatedSubscriptions = updatedSubscriptions.filter(p => p !== product);
      let stillSubscribed = false;
      clients.forEach(({ subscriptions }) => {
        if (subscriptions.includes(product)) stillSubscribed = true;
      });
      if (!stillSubscribed) {
        activeSubscriptions.delete(product);
        if (coinbaseWs.readyState === WebSocket.OPEN) {
          coinbaseWs.send(JSON.stringify({
            type: 'unsubscribe',
            product_ids: [product],
            channels: ['level2', 'matches'],
          }));
        }
      }
    }

    clientData.subscriptions = updatedSubscriptions;
    clients.set(ws, clientData);

    if (dbConnected) {
      try {
        await Subscription.updateOne(
          { userId },
          { products: updatedSubscriptions, lastUpdated: Date.now() },
          { upsert: true }
        );
      } catch (err) {
        console.error(`DB update failed for user ${userId}:`, err.message);
      }
    }

    ws.send(JSON.stringify({ type: 'subscriptions', products: updatedSubscriptions }));
  });

  ws.on('close', () => {
    console.log(`User ${userId} disconnected`);
    const clientSubscriptions = clients.get(ws).subscriptions;
    clients.delete(ws);
    clientSubscriptions.forEach(product => {
      let stillSubscribed = false;
      clients.forEach(({ subscriptions }) => {
        if (subscriptions.includes(product)) stillSubscribed = true;
      });
      if (!stillSubscribed && activeSubscriptions.has(product)) {
        activeSubscriptions.delete(product);
        if (coinbaseWs.readyState === WebSocket.OPEN) {
          coinbaseWs.send(JSON.stringify({
            type: 'unsubscribe',
            product_ids: [product],
            channels: ['level2', 'matches'],
          }));
        }
      }
    });
  });

  ws.on('error', (error) => console.error(`WebSocket error for user ${userId}:`, error.message));
});

// Start Server
const startServer = async () => {
  await connectWithRetry();
  initializeWebSocket();
  server.listen(4000, () => console.log('Server running on port 4000'));
};

startServer();