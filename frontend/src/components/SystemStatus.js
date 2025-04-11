import React from 'react';

const SystemStatus = ({ channels }) => {
  return (
    <div className="card">
      <h2>System Status</h2>
      <ul className="channel-list">
        {channels.length === 0 ? (
          <li>No active channels</li>
        ) : (
          channels.map((channel, index) => (
            <li key={index} className="channel-item">
              {Object.entries(channel)
                .filter(([key]) => key !== 'account_ids') // Exclude account_ids
                .map(([key, value]) => (
                  <span key={key}>
                    <strong>{key}:</strong> {JSON.stringify(value)}<br />
                  </span>
                ))}
            </li>
          ))
        )}
      </ul>
    </div>
  );
};

export default SystemStatus;