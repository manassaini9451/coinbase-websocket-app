import React, { useState, useEffect, useRef } from 'react';
import SubscribeControl from './components/SubscribeControl';
import PriceView from './components/PriceView';
import MatchView from './components/MatchView';
import SystemStatus from './components/SystemStatus';
import './styles.css';

function App() {
  const [ws, setWs] = useState(null);
  const [userId, setUserId] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [prices, setPrices] = useState({});
  const [matches, setMatches] = useState({});
  const [channels, setChannels] = useState([]);
  const pendingRequests = useRef([]);
  const reconnectTimeout = useRef(null);

  const connectWebSocket = () => {
    const websocket = new WebSocket('ws://localhost:4000/ws');
    websocket.onopen = () => {
      console.log('WebSocket connected');
      setWs(websocket);
      while (pendingRequests.current.length > 0) {
        const { product, action } = pendingRequests.current.shift();
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ action, product }));
        }
      }
    };

    websocket.onmessage = (event) => {
      const { type, product, data, products } = JSON.parse(event.data);
      console.log('Received message:', { type, product, data, products });

      switch (type) {
        case 'userId':
          setUserId(data);
          break;
        case 'subscriptions':
          setSubscriptions(products || []); // Sync from server only
          break;
        case 'price':
          setPrices(prev => ({
            ...prev,
            [product]: { bids: data.bids || [], asks: data.asks || [] },
          }));
          break;
        case 'match':
          setMatches(prev => ({
            ...prev,
            [product]: [data, ...(prev[product] || [])].slice(0, 50),
          }));
          break;
        case 'channels':
          setChannels(data);
          break;
        default:
          console.log('Unhandled message type:', type);
      }
    };

    websocket.onclose = () => {
      console.log('WebSocket closed');
      setWs(null);
      if (!reconnectTimeout.current) {
        reconnectTimeout.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
          reconnectTimeout.current = null;
        }, 2000);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return websocket;
  };

  useEffect(() => {
    const websocket = connectWebSocket();
    return () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, []);

  const handleSubscribe = (product, action) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, product }));
    } else {
      console.log('WebSocket not ready, queuing request:', { product, action });
      pendingRequests.current.push({ product, action });
    }
  };

  // 50ms refresh for Price View
  useEffect(() => {
    const interval = setInterval(() => {
      setPrices(prev => ({ ...prev })); // Trigger re-render
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Coinbase Pro Dashboard</h1>
        <p>User ID: {userId || 'Connecting...'}</p>
      </header>
      <main className="app-main">
        <section className="subscribe-section">
          <h2>Subscribe/Unsubscribe</h2>
          <SubscribeControl subscriptions={subscriptions} onSubscribe={handleSubscribe} />
        </section>
        <div className="dashboard-grid">
          <PriceView prices={prices} />
          <MatchView matches={matches} />
          <SystemStatus channels={channels} />
        </div>
      </main>
    </div>
  );
}

export default App;