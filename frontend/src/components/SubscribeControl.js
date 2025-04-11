import React from 'react';

const SubscribeControl = ({ subscriptions, onSubscribe }) => {
  const products = ['BTC-USD', 'ETH-USD', 'XRP-USD', 'LTC-USD'];

  return (
    <div className="card">
      <h2>Subscription Control</h2>
      <div className="subscription-grid">
        {products.map(product => (
          <div key={product} className="subscription-item">
            <span className="product-name">{product}</span>
            <button
              className="btn subscribe-btn"
              onClick={() => onSubscribe(product, 'subscribe')}
              disabled={subscriptions.includes(product)}
            >
              Subscribe
            </button>
            <button
              className="btn unsubscribe-btn"
              onClick={() => onSubscribe(product, 'unsubscribe')}
              disabled={!subscriptions.includes(product)}
            >
              Unsubscribe
            </button>
            <span className={`status ${subscriptions.includes(product) ? 'subscribed' : 'unsubscribed'}`}>
              {subscriptions.includes(product) ? 'Subscribed' : 'Unsubscribed'}
            </span>
          </div>
        ))}
        {subscriptions.length === 0 && <p className="no-subs">No subscriptions</p>}
      </div>
    </div>
  );
};

export default SubscribeControl;