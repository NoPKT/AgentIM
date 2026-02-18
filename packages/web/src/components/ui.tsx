import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

// ─── Button ───

const buttonBase =
  'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

const buttonVariants = {
  primary:
    'bg-accent hover:bg-accent-hover text-white focus:ring-accent',
  secondary:
    'text-text-secondary hover:bg-surface-hover focus:ring-border',
  danger:
    'bg-danger hover:bg-danger-hover text-white focus:ring-danger',
  ghost:
    'text-text-secondary hover:bg-surface-hover focus:ring-border',
} as const

const buttonSizes = {
  sm: 'px-3 py-1 text-xs rounded-md gap-1',
  md: 'px-4 py-2 text-sm rounded-lg gap-2',
  lg: 'px-5 py-2.5 text-sm rounded-lg gap-2',
} as const

type ButtonVariant = keyof typeof buttonVariants
type ButtonSize = keyof typeof buttonSizes

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      className={twMerge(`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]}`, className)}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

// ─── Shared form field base ───

const fieldBase =
  'w-full border border-border bg-surface text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors'

const fieldSizes = {
  sm: 'px-2.5 py-1.5 text-xs rounded-md',
  md: 'px-3 py-2 text-sm rounded-lg',
  lg: 'px-4 py-2.5 text-sm rounded-lg',
} as const

type FieldSize = keyof typeof fieldSizes

// ─── Input ───

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: FieldSize
  error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ inputSize = 'md', error = false, className, ...props }, ref) => (
    <input
      ref={ref}
      className={twMerge(`${fieldBase} ${fieldSizes[inputSize]} ${error ? 'border-danger focus:ring-danger' : ''}`, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

// ─── Textarea ───

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: FieldSize
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ inputSize = 'md', error = false, className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={twMerge(`${fieldBase} ${fieldSizes[inputSize]} resize-none ${error ? 'border-danger focus:ring-danger' : ''}`, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

// ─── Select ───

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  inputSize?: FieldSize
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ inputSize = 'md', className, ...props }, ref) => (
    <select
      ref={ref}
      className={twMerge(`${fieldBase} ${fieldSizes[inputSize]}`, className)}
      {...props}
    />
  ),
)
Select.displayName = 'Select'
