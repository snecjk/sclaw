import './TutorialViewer.css';
import { normalizeTutorialHtml } from './tutorial-html';

export interface TutorialViewerProps { html: string; className?: string }

export function TutorialViewer({ html, className = '' }: TutorialViewerProps) {
  return <article
    className={`tutorial-viewer ${className}`.trim()}
    data-testid="tutorial-viewer"
    dangerouslySetInnerHTML={{ __html: normalizeTutorialHtml(html) }}
  />;
}
