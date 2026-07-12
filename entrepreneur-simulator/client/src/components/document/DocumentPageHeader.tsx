import React, { useLayoutEffect, useRef } from 'react';
import { clsx } from 'clsx';

export interface DocumentPageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'onChange'> {
  title: string;
  onTitleChange?: (title: string) => void;
  titlePlaceholder?: string;
  titleAriaLabel?: string;
  readOnly?: boolean;
  icon?: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export function DocumentPageHeader({
  title,
  onTitleChange,
  titlePlaceholder = '无标题',
  titleAriaLabel = '文档标题',
  readOnly = false,
  icon,
  eyebrow,
  description,
  meta,
  actions,
  className,
  ...rest
}: DocumentPageHeaderProps) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const canEdit = Boolean(onTitleChange) && !readOnly;

  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);

  return (
    <header className={clsx('smart-document-page-header', className)} {...rest}>
      <div className="smart-document-page-header__track">
        {eyebrow ? <div className="smart-document-page-header__eyebrow">{eyebrow}</div> : null}
        <div className="smart-document-page-header__title-row">
          <div className="smart-document-page-header__title-wrap">
            {icon ? <div className="smart-document-page-header__icon" aria-hidden="true">{icon}</div> : null}
            {canEdit ? (
              <textarea
                ref={titleRef}
                value={title}
                rows={1}
                spellCheck="true"
                className="smart-document-page-header__title-input"
                aria-label={titleAriaLabel}
                placeholder={titlePlaceholder}
                onChange={(event) => onTitleChange?.(event.target.value.replace(/\r?\n/g, ' '))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
              />
            ) : (
              <h1 className="smart-document-page-header__title">
                {title.trim() || titlePlaceholder}
              </h1>
            )}
          </div>
          {actions ? <div className="smart-document-page-header__actions">{actions}</div> : null}
        </div>
        {description ? <div className="smart-document-page-header__description">{description}</div> : null}
        {meta ? <div className="smart-document-page-header__meta">{meta}</div> : null}
      </div>
    </header>
  );
}
