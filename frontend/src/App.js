import React, { useState, useEffect, useRef } from 'react';
import SubscribeControl from './components/SubscribeControl';
import PriceView from './components/PriceView';
import MatchView from './components/MatchView';
import SystemStatus from './components/SystemStatus';
import './styles.css';

function App() {
  const [ws, setWs] = useState(null);
  const [userId, setUserId] = useState(localStorage.getItem('userId')); // Load from localStorage
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
      pendingRequests.current.forEach(({ product, action }) => {
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ action, product }));
        }
      });
      pendingRequests.current = [];
    };

    websocket.onmessage = (event) => {
      const { type, product, data, userId: receivedUserId, products } = JSON.parse(event.data);
      switch (type) {
        case 'userId':
          setUserId(receivedUserId);
          localStorage.setItem('userId', receivedUserId); // Save to localStorage
          break;
        case 'subscriptions':
          setSubscriptions(products || []);
          break;
        case 'price':
          setPrices(prev => ({ ...prev, [product]: data }));
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

    websocket.onerror = (error) => console.error('WebSocket error:', error);

    return websocket;
  };

  useEffect(() => {
    const websocket = connectWebSocket();
    return () => {
      if (websocket.readyState === WebSocket.OPEN) websocket.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, []);

  const handleSubscribe = (product, action) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, product }));
      setSubscriptions(prev =>
        action === 'subscribe' ? [...new Set([...prev, product])] : prev.filter(p => p !== product)
      );
    } else {
      pendingRequests.current.push({ product, action });
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Coinbase Pro Dashboard</h1>
        <p>User NAME: {userId || 'Connecting...'}</p>
      </header>
      <main className="app-main">
        <section className="subscribe-section">
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