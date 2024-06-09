// src/components/TransactionList.tsx
import React from 'react';
import { List, ListItem, ListItemText, Divider } from '@mui/material';

const TransactionList: React.FC<{ transaction: any }> = ({ transaction }) => {
  return (
    <List>
      <Divider />
      <div>
        <ListItem>
          <ListItemText
            primary={transaction.memo}
            secondary={new Date(transaction.time * 1000).toLocaleDateString()}
          />
          <ListItemText
            primary={`${transaction.pending ? '-' : '+'} ${
              transaction.amount
            } Sats`}
            style={{ textAlign: 'right' }}
          />
        </ListItem>
        <Divider />
      </div>
    </List>
  );
};

export default TransactionList;
