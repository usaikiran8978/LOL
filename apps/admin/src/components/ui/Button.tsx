import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md';
  'data-autofocus'?: boolean;
}) {
  return <button {...rest} type={type} className={`btn btn--${variant} btn--${size}${className ? ` ${className}` : ''}`} />;
}
