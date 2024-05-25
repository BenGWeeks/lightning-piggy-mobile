// src/components/TransactionList.tsx
import React from 'react';
import { List, ListItem, ListItemText, Divider } from '@mui/material';

const transactions = [
  { date: '29 April 2024', description: 'Bitrefill', amount: '- 50,000 Sats' },
  { date: '28 April 2024', description: 'Robotechy.com', amount: '- 30,500 Sats' },
  { date: '28 April 2024', description: 'Allowance', amount: '+ 110,000 Sats' },
];

const TransactionList: React.FC = () => {
  return (
    <List>
      <Divider />
      {transactions.map((transaction, index) => (
        <div key={index}>
          <ListItem>
            <ListItemText
              primary={transaction.description}
              secondary={transaction.date}
            />
            <ListItemText
              primary={transaction.amount}
              style={{ textAlign: 'right' }}
            />
          </ListItem>
          <Divider />
        </div>
      ))}
    </List>
  );
};

export default TransactionList;