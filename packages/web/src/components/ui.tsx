import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

// ─── Button ───

const buttonBase =
  'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

const buttonVariants = {
  primary:
    'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
  secondary:
    'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:ring-gray-400',
  danger:
    'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  ghost:
    'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 focus:ring-gray-400',
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
  ({ variant = 'primary', size = 'md', className = '', ...props }, ref) => (
    <button
      ref={ref}
      className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

// ─── Input ───

const inputBase =
  'w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'

const inputSizes = {
  sm: 'px-2.5 py-1.5 text-xs rounded-md',
  md: 'px-3 py-2 text-sm rounded-lg',
  lg: 'px-4 py-2.5 text-sm rounded-lg',
} as const

type InputSize = keyof typeof inputSizes

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ inputSize = 'md', className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`${inputBase} ${inputSizes[inputSize]} ${className}`}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

// ─── Textarea ───

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: InputSize
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ inputSize = 'md', className = '', ...props }, ref) => (
    <textarea
      ref={ref}
      className={`${inputBase} ${inputSizes[inputSize]} resize-none ${className}`}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
