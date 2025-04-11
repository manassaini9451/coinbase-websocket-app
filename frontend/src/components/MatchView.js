import React from 'react';

const MatchView = ({ matches }) => {
  return (
    <div className="card">
      <h2>Match View</h2>
      <div className="match-container">
        <div className="match-list">
          {Object.keys(matches).length === 0 ? (
            <p>No matches available</p>
          ) : (
            Object.keys(matches).flatMap(product =>
              matches[product].map((match, index) => (
                <div
                  key={`${product}-${index}`}
                  className="match-row"
                  style={{ color: match.side === 'buy' ? 'green' : 'red' }}
                >
                  <span>{new Date(match.time).toLocaleTimeString()}</span>
                  <span>{product}</span>
                  <span>{match.size}</span>
                  <span>{match.price}</span>
                </div>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default MatchView;