import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '../../i18n';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { AlertHost, appAlert } from '../AppAlert';

const host = () =>
  render(
    <ThemeProvider>
      <AlertHost />
    </ThemeProvider>,
  );

describe('appAlert', () => {
  it('renders a branded dialog and runs the pressed button', () => {
    host();
    const onDelete = jest.fn();
    act(() => appAlert('Delete photo?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: onDelete }]));
    expect(screen.getByText('Delete photo?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('app-alert-destructive'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('app-alert')).toBeNull();
  });

  it('defaults to a single OK button and shows queued alerts one at a time', () => {
    host();
    act(() => {
      appAlert('First');
      appAlert('Second');
    });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.queryByText('Second')).toBeNull();
    fireEvent.press(screen.getByText('OK'));
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('falls back to the native alert when no host is mounted', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    appAlert('Native');
    expect(spy).toHaveBeenCalledWith('Native', undefined, undefined);
    spy.mockRestore();
  });
});
