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

// List of random names and tracking for uniqueness
const randomNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
const usedNames = new Set();

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
        useNewUrlParser: true,
        useUnifiedTopology: true,
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
      console.log('Sending initial subscription:', subscribeMessage);
      coinbaseWs.send(subscribeMessage);
    }
  });

  coinbaseWs.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Received from Coinbase:', msg.type);

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
        console.log('Active channels:', msg.channels);
        broadcastToAll('channels', msg.channels);
        break;
      case 'error':
        console.error('Coinbase WebSocket Error:', msg.message);
        break;
      default:
        console.log('Unhandled message:', msg);
        break;
    }
  });

  coinbaseWs.on('close', (code, reason) => {
    console.log('Coinbase WebSocket closed, Code:', code, 'Reason:', reason.toString());
    console.log('Reconnecting in 2 seconds...');
    setTimeout(initializeWebSocket, 2000);
  });

  coinbaseWs.on('error', (error) => {
    console.error('Coinbase WebSocket Error:', error.message);
  });
};

// Update order book based on l2update
function updateOrderBook(update) {
  const book = orderBooks.get(update.product_id);
  update.changes.forEach(([side, price, size]) => {
    const bookSide = side === 'buy' ? book.bids : book.asks;
    const priceNum = price;
    const sizeNum = size;
    const index = bookSide.findIndex(([p]) => p === priceNum);
    if (sizeNum === '0') {
      if (index !== -1) bookSide.splice(index, 1);
    } else if (index !== -1) {
      bookSide[index] = [priceNum, sizeNum];
    } else {
      bookSide.push([priceNum, sizeNum]);
    }
  });
}

// Broadcast to subscribed clients
function broadcastToSubscribed(product, type, data) {
  clients.forEach(({ userId, subscriptions }, ws) => {
    if (subscriptions.includes(product) && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, product, data }));
    }
  });
}

// Broadcast to all clients
function broadcastToAll(type, data) {
  clients.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  });
}

// Handle WebSocket client connections
wss.on('connection', async (ws) => {
  // Generate unique random name
  let userId;
  const availableNames = randomNames.filter(name => !usedNames.has(name));
  if (availableNames.length > 0) {
    userId = availableNames[Math.floor(Math.random() * availableNames.length)];
  } else {
    // If all names are used, append a number
    let counter = 1;
    do {
      userId = `${randomNames[Math.floor(Math.random() * randomNames.length)]}${counter}`;
      counter++;
    } while (usedNames.has(userId));
  }
  usedNames.add(userId);

  let subscriptions = [];
  let dbConnected = mongoose.connection.readyState === 1;

  if (dbConnected) {
    try {
      let subDoc = await Subscription.findOne({ userId });
      if (!subDoc) {
        subDoc = await Subscription.create({ userId, products: [] });
      }
      subscriptions = subDoc.products;
    } catch (err) {
      console.error(`Error loading subscriptions for user ${userId}:`, err.message);
      subscriptions = [];
    }
  } else {
    console.log(`Using in-memory subscriptions for user ${userId} due to DB failure`);
    subscriptions = [];
  }

  clients.set(ws, { userId, subscriptions });
  ws.send(JSON.stringify({ type: 'userId', userId }));
  ws.send(JSON.stringify({ type: 'subscriptions', products: subscriptions }));
  console.log(`User ${userId} connected`);

  ws.on('message', async (message) => {
    const { action, product } = JSON.parse(message);
    if (!PRODUCTS.includes(product)) return;

    let clientData = clients.get(ws);
    let updatedSubscriptions = [...clientData.subscriptions];

    if (action === 'subscribe' && !updatedSubscriptions.includes(product)) {
      updatedSubscriptions.push(product);
      activeSubscriptions.add(product);
      if (coinbaseWs.readyState === WebSocket.OPEN) {
        const subscribeMessage = JSON.stringify({
          type: 'subscribe',
          product_ids: [product],
          channels: ['level2', 'matches'],
        });
        console.log(`User ${userId} subscribed to ${product}, sending:`, subscribeMessage);
        coinbaseWs.send(subscribeMessage);
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
          const unsubscribeMessage = JSON.stringify({
            type: 'unsubscribe',
            product_ids: [product],
            channels: ['level2', 'matches'],
          });
          console.log(`User ${userId} unsubscribed from ${product}, sending:`, unsubscribeMessage);
          coinbaseWs.send(unsubscribeMessage);
        }
      }
    }

    clientData.subscriptions = updatedSubscriptions;
    clients.set(ws, clientData);

    if (dbConnected) {
      try {
        await Subscription.findOneAndUpdate(
          { userId },
          { products: updatedSubscriptions, lastUpdated: Date.now() },
          { upsert: true, new: true, runValidators: true }
        );
        console.log(`Updated subscriptions for user ${userId}:`, updatedSubscriptions);
      } catch (err) {
        console.error(`Failed to update subscriptions in DB for user ${userId}:`, err.message);
      }
    } else {
      console.log(`Subscriptions for user ${userId} updated in-memory:`, updatedSubscriptions);
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
          const unsubscribeMessage = JSON.stringify({
            type: 'unsubscribe',
            product_ids: [product],
            channels: ['level2', 'matches'],
          });
          console.log(`No users subscribed to ${product}, sending:`, unsubscribeMessage);
          coinbaseWs.send(unsubscribeMessage);
        }
      }
    });
    usedNames.delete(userId); // Free up the name for reuse
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for user ${userId}:`, error.message);
  });
});

// Start the server
const startServer = async () => {
  const dbSuccess = await connectWithRetry();
  if (!dbSuccess) {
    console.log('Proceeding with in-memory storage due to MongoDB failure');
  }
  initializeWebSocket();
  server.listen(4000, () => console.log('Server running on port 4000'));
};

startServer();