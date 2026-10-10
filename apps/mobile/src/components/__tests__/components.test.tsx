import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ApiError } from '../../api/errors';
import '../../i18n';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { MIN_TOUCH } from '../../theme/tokens';
import { Button } from '../Button';
import { ChipGroup } from '../Chip';
import { OtpInput } from '../OtpInput';
import { RangeSlider } from '../RangeSlider';
import { Screen } from '../Screen';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider scheme="light">{ui}</ThemeProvider>);
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(typeof el.props.style === 'function' ? (el.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : el.props.style) as Record<string, number>;

describe('Button', () => {
  it('exposes role, label and busy/disabled state, with a >= 44pt touch target', () => {
    const onPress = jest.fn();
    wrap(<Button label="Go" onPress={onPress} loading testID="b" />);
    const b = screen.getByTestId('b');
    expect(b.props.accessibilityRole).toBe('button');
    expect(b.props.accessibilityLabel).toBe('Go');
    expect(b.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(flat(b).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    fireEvent.press(b);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('ChipGroup', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }];

  it('single-select uses radio semantics and replaces the selection', () => {
    const onChange = jest.fn();
    wrap(<ChipGroup label="Pick" options={options} selected={['a']} onChange={onChange} testID="g" />);
    expect(screen.getByTestId('g-a').props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('g-a').props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId('g-b'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('multi-select respects max by disabling unselected chips', () => {
    const onChange = jest.fn();
    wrap(<ChipGroup label="Pick" options={options} selected={['a', 'b']} onChange={onChange} multiple max={2} testID="g" />);
    expect(screen.getByTestId('g-c').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('g-a'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });
});

describe('OtpInput', () => {
  it('keeps digits only and fires onComplete at 6 digits', () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    wrap(<OtpInput label="Code" value="" onChange={onChange} onComplete={onComplete} testID="otp" />);
    fireEvent.changeText(screen.getByTestId('otp'), '12-34 56');
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(screen.getByLabelText('Code').props.textContentType).toBe('oneTimeCode');
  });
});

describe('RangeSlider', () => {
  it('thumbs are adjustable with increment/decrement actions and stay ordered', () => {
    const onChange = jest.fn();
    wrap(<RangeSlider label="Age" min={18} max={99} low={30} high={31} onChange={onChange} format={String} lowLabel="Min" highLabel="Max" testID="r" />);
    const low = screen.getByTestId('r-low');
    expect(low.props.accessibilityRole).toBe('adjustable');
    expect(low.props.accessibilityValue).toMatchObject({ now: 30, text: '30' });
    fireEvent(low, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(29, 31);
    fireEvent(low, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(31, 31);
  });

  it('a low thumb at the high value cannot pass it', () => {
    const onChange = jest.fn();
    wrap(<RangeSlider label="Age" min={18} max={99} low={31} high={31} onChange={onChange} format={String} lowLabel="Min" highLabel="Max" testID="r" />);
    fireEvent(screen.getByTestId('r-low'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(31, 31);
  });
});

describe('Screen states', () => {
  it('renders loading, empty and error-with-retry (including the request reference)', () => {
    const { rerender } = wrap(<Screen status="loading" />);
    expect(screen.getByTestId('screen-loading')).toBeTruthy();

    rerender(<ThemeProvider scheme="light"><Screen status="empty" emptyTitle="Nothing" /></ThemeProvider>);
    expect(screen.getByText('Nothing')).toBeTruthy();

    const onRetry = jest.fn();
    rerender(<ThemeProvider scheme="light"><Screen status="error" error={new ApiError('NETWORK', 0, undefined, 'rid-9')} onRetry={onRetry} /></ThemeProvider>);
    expect(screen.getByText('No connection. Check your internet and try again.')).toBeTruthy();
    expect(screen.getByText('Reference: rid-9')).toBeTruthy();
    fireEvent.press(screen.getByTestId('screen-retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});
