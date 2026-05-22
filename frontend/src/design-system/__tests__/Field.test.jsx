import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field, Input, Select, Textarea } from '../Field';

describe('Field', () => {
  it('renders the label and links it to the control', () => {
    render(
      <Field label="Deal name">
        <Input defaultValue="" />
      </Field>,
    );
    expect(screen.getByLabelText('Deal name')).toBeInstanceOf(HTMLInputElement);
  });

  it('marks required fields with an asterisk', () => {
    const { container } = render(
      <Field label="Deal name" required>
        <Input />
      </Field>,
    );
    expect(container.textContent).toContain('*');
  });

  it('shows an error message and marks the control invalid', () => {
    render(
      <Field label="Deal name" error="Name is required">
        <Input />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
    expect(screen.getByLabelText('Deal name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows helper text when there is no error', () => {
    render(
      <Field label="Deal name" helper="As it appears on the term sheet">
        <Input />
      </Field>,
    );
    expect(screen.getByText('As it appears on the term sheet')).toBeInTheDocument();
  });
});

describe('Input / Select / Textarea', () => {
  it('Input applies the invalid border when invalid', () => {
    const { container } = render(<Input invalid />);
    expect(container.querySelector('input')?.className).toMatch(/border-data-negative/);
  });

  it('Textarea renders with the requested rows', () => {
    render(<Textarea rows={5} aria-label="notes" />);
    expect(screen.getByLabelText('notes')).toHaveAttribute('rows', '5');
  });

  it('Select renders its options', () => {
    render(
      <Select aria-label="stage">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    expect(screen.getByLabelText('stage')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument();
  });

  it('controls forward a ref to the native element', () => {
    const ref = { current: null };
    render(<Input ref={ref} aria-label="x" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
