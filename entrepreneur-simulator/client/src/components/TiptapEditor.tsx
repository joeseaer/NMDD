import { SmartDocumentEditor } from './SmartDocumentEditor';
import type { SmartDocumentValue } from './SmartDocumentEditor';

export { SmartDocumentEditor };
export type { SmartDocumentValue };

export const TiptapEditor = ({
    content,
    onChange,
}: {
    content: string;
    onChange: (content: string) => void;
}) => (
    <SmartDocumentEditor
        content={content}
        onChange={(value) => onChange(value.markdown)}
    />
);
