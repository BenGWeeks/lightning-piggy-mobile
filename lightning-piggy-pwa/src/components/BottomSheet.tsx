// src/components/BottomSheet.tsx
import React, { ReactNode } from 'react';
import Modal from '@mui/material/Modal';
import { styled } from '@mui/system';

const SheetContainer = styled('div')(({ theme }) => ({
  position: 'absolute',
  bottom: 0,
  width: '100%',
  backgroundColor: '#fff',
  boxShadow: '0px -2px 10px rgba(0, 0, 0, 0.1)',
  padding: '16px 32px 24px',
  outline: 'none',
  borderRadius: '10px 10px 0 0',
}));

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  children,
}) => {
  return (
    <Modal open={open} onClose={onClose} aria-labelledby="bottom-sheet-title">
      <SheetContainer>{children}</SheetContainer>
    </Modal>
  );
};

export default BottomSheet;
