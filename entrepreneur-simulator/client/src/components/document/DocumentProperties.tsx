import React from 'react';
import { clsx } from 'clsx';

export interface DocumentPropertiesProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  label?: string;
  actions?: React.ReactNode;
}

export function DocumentProperties({
  children,
  label = '文档属性',
  actions,
  className,
  ...rest
}: DocumentPropertiesProps) {
  return (
    <section className={clsx('smart-document-properties', className)} aria-label={label} {...rest}>
      <div className="smart-document-properties__track">
        <div className="smart-document-properties__list">{children}</div>
        {actions ? <div className="smart-document-properties__actions">{actions}</div> : null}
      </div>
    </section>
  );
}

export interface DocumentPropertyProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function DocumentProperty({ label, icon, children, className, ...rest }: DocumentPropertyProps) {
  return (
    <div className={clsx('smart-document-property', className)} {...rest}>
      <div className="smart-document-property__label">
        {icon ? <span className="smart-document-property__icon" aria-hidden="true">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div className="smart-document-property__value">{children}</div>
    </div>
  );
}
