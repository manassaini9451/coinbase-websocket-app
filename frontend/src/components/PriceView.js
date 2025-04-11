import React from 'react';

const PriceView = ({ prices }) => {
  return (
    <div className="card">
      <h2>Price View</h2>
      {Object.keys(prices).length === 0 ? (
        <p>No data available</p>
      ) : (
        Object.keys(prices).map(product => (
          <div key={product} className="price-container">
            <h3>{product}</h3>
            <div className="price-grid">
              <div className="bids">
                <h4>Bids</h4>
                {prices[product].bids.map(([price, size], index) => (
                  <div key={index} className="price-row">
                    <span>{price}</span>
                    <span>{size}</span>
                  </div>
                ))}
              </div>
              <div className="asks">
                <h4>Asks</h4>
                {prices[product].asks.map(([price, size], index) => (
                  <div key={index} className="price-row">
                    <span>{price}</span>
                    <span>{size}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default PriceView;