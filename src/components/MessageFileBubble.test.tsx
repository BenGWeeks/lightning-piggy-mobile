import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MessageFileBubble from './MessageFileBubble';
import { Alert } from './BrandedAlert';
import { shareFileAttachment } from '../services/fileShare';
import { FileVerificationError } from '../services/fileDownload';
import { parseFileAttachment } from '../utils/fileAttachment';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../styles/palettes').lightPalette,
}));
jest.mock('../contexts/LocaleContext', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock('./BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../services/fileShare', () => ({ shareFileAttachment: jest.fn(async () => {}) }));
const file = (name = 'invoice.pdf', mime = 'application/pdf') =>
  parseFileAttachment(
    '[FILE]' +
      JSON.stringify({ name, mime, encrypted: false, url: 'https://example.com/f', size: 999 }),
  )!;
const bubble = (attachment = file()) =>
  render(<MessageFileBubble id="file" file={attachment} fromMe={false} footer={null} />);
beforeEach(() => jest.clearAllMocks());
it('offers only Save for dangerous files and requires the explicit warning', async () => {
  let approved: boolean | undefined;
  (shareFileAttachment as jest.Mock).mockImplementationOnce(async (_file, confirm) => {
    approved = await confirm();
  });
  const ui = bubble(file('invoice.pdf.exe'));
  expect(ui.getByText('messageBubble.fileSave')).toBeTruthy();
  expect(ui.queryByText('messageBubble.fileShare')).toBeNull();
  fireEvent.press(ui.getByTestId('chat-file-share-file'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('messageBubble.fileWarningTitle');
  expect(body).toBe('messageBubble.fileWarning');
  expect(approved).toBeUndefined();
  buttons[1].onPress();
  await waitFor(() => expect(approved).toBe(true));
});
it('shows the localized verification failure after a hash mismatch', async () => {
  (shareFileAttachment as jest.Mock).mockRejectedValueOnce(new FileVerificationError());
  const ui = bubble();
  fireEvent.press(ui.getByTestId('chat-file-share-file'));
  await waitFor(() => expect(ui.getByText('messageBubble.fileVerificationFailed')).toBeTruthy());
});
it('shows type mismatch and replaces declared MIME with the verified type', async () => {
  (shareFileAttachment as jest.Mock).mockImplementationOnce(async (_file, _confirm, verified) => {
    verified({ mime: 'application/octet-stream', size: 3 });
  });
  const ui = bubble(file('invoice.exe'));
  expect(ui.getByText('messageBubble.fileTypeMismatch')).toBeTruthy();
  fireEvent.press(ui.getByTestId('chat-file-share-file'));
  await waitFor(() => expect(ui.getByText('application/octet-stream')).toBeTruthy());
  expect(ui.queryByText('application/pdf')).toBeNull();
});
