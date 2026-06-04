/**
 * User Form Schema Types (Electron Main Process)
 * 
 * Defines the structure for dynamic forms that can be shown to users
 * when the AI agent needs confirmation or input during execution.
 */

/** Base field type */
export type FormFieldType = 
  | 'text'           // Single line text input
  | 'textarea'       // Multi-line text input
  | 'number'         // Number input
  | 'select'         // Single select dropdown
  | 'multiselect'    // Multiple select dropdown
  | 'radio'          // Radio button group (single select)
  | 'checkbox'       // Checkbox (boolean or multiple)
  | 'date'           // Date picker
  | 'datetime'       // Date and time picker
  | 'time'           // Time picker
  | 'toggle'         // Boolean toggle switch
  | 'hidden'         // Hidden field for passing data
  ;

/** Option for select/radio/checkbox fields */
export interface FormFieldOption {
  value: string | number | boolean;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Validation rule for a field */
export interface FormFieldValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;        // For number/date fields
  max?: number;        // For number/date fields
  pattern?: string;    // Regex pattern for text fields
  custom?: (value: unknown) => string | null; // Custom validation, returns error message or null
}

/** Base field configuration */
export interface FormFieldBase {
  name: string;                    // Field identifier (used as key in result)
  type: FormFieldType;
  label: string;                   // Display label
  description?: string;            // Help text below label
  placeholder?: string;            // Placeholder text for inputs
  defaultValue?: unknown;          // Default value
  validation?: FormFieldValidation;
  hidden?: boolean;                // If true, field is hidden but still submitted
  disabled?: boolean;              // If true, field is disabled (read-only)
}

/** Text field configuration */
export interface TextField extends FormFieldBase {
  type: 'text' | 'textarea';
  maxLength?: number;
  rows?: number;  // For textarea only
}

/** Number field configuration */
export interface NumberField extends FormFieldBase {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;   // e.g., "$", "¥"
  suffix?: string;   // e.g., "kg", "items"
}

/** Select field configuration */
export interface SelectField extends FormFieldBase {
  type: 'select' | 'multiselect';
  options: FormFieldOption[];
  searchable?: boolean;  // Enable search/filter for long option lists
}

/** Radio field configuration */
export interface RadioField extends FormFieldBase {
  type: 'radio';
  options: FormFieldOption[];
  layout?: 'vertical' | 'horizontal';
}

/** Checkbox field configuration */
export interface CheckboxField extends FormFieldBase {
  type: 'checkbox';
  options?: FormFieldOption[];  // For multiple checkboxes
  trueLabel?: string;           // Label when checked (for single checkbox)
  falseLabel?: string;          // Label when unchecked (for single checkbox)
}

/** Date/Time field configuration */
export interface DateTimeField extends FormFieldBase {
  type: 'date' | 'datetime' | 'time';
  format?: string;              // Display format, e.g., "YYYY-MM-DD"
  minDate?: string;             // Minimum date (ISO string)
  maxDate?: string;             // Maximum date (ISO string)
}

/** Toggle field configuration */
export interface ToggleField extends FormFieldBase {
  type: 'toggle';
  trueLabel?: string;
  falseLabel?: string;
}

/** Hidden field configuration */
export interface HiddenField extends FormFieldBase {
  type: 'hidden';
  defaultValue: string | number | boolean;
}

/** Union type for all field types */
export type FormField = 
  | TextField 
  | NumberField 
  | SelectField 
  | RadioField 
  | CheckboxField 
  | DateTimeField 
  | ToggleField
  | HiddenField;

/** Form layout configuration */
export interface FormLayout {
  columns?: 1 | 2 | 3;                    // Number of columns
  labelWidth?: 'auto' | 'fixed';          // Label width mode
  labelAlign?: 'left' | 'right' | 'top';  // Label alignment
  fieldSpacing?: 'compact' | 'normal' | 'loose';
}

/** Form modal configuration */
export interface UserFormConfig {
  id: string;                    // Unique form identifier
  title: string;                 // Modal title
  description?: string;          // Modal description/subtitle
  fields: FormField[];           // Form fields
  layout?: FormLayout;           // Layout configuration
  confirmLabel?: string;         // Confirm button text (default: "确认")
  cancelLabel?: string;          // Cancel button text (default: "取消")
  allowCancel?: boolean;         // Whether user can cancel (default: true)
  closeOnCancel?: boolean;       // Close modal on cancel (default: true)
  closeOnConfirm?: boolean;      // Close modal on confirm (default: true)
  width?: 'sm' | 'md' | 'lg' | 'xl' | number; // Modal width
  context?: Record<string, unknown>; // Additional context data passed with form
}

/** Form result - values submitted by user */
export type FormResult = Record<string, unknown>;

/** Form response with status */
export interface FormResponse {
  formId: string;
  cancelled: boolean;
  values?: FormResult;
  timestamp: string;
}

/** Request to show a form */
export interface ShowFormRequest {
  config: UserFormConfig;
  sessionId?: string;          // Optional session context
  source?: 'skill' | 'intent' | 'workflow' | 'tool';  // Source of the form request
  sourceId?: string;           // ID of the source (skill name, tool name, etc.)
}
