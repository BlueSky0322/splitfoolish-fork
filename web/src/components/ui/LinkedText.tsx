import type { ReactNode } from 'react';
import { findLinks, shortLink } from '../../utils/text';
import classes from './LinkedText.module.css';

interface LinkedTextProps {
  text: string;
  /** How a link is shown instead of its address, where the screen knows better */
  renderLink?: (href: string) => ReactNode;
}

/**
 * Text as typed, with the web addresses in it as links that open in a new tab, each
 * shown short ("example.com/menu"). A click on one goes nowhere else, so a row or
 * button around the text doesn't open as well.
 */
const LinkedText = ({ text, renderLink }: LinkedTextProps) => (
  <>
    {findLinks(text).map((part, i) => {
      if (part.href == null) return part.text;
      const shown = renderLink?.(part.href);
      if (shown != null) return <span key={i}>{shown}</span>;
      return (
        <a
          key={i}
          className={classes.link}
          href={part.href}
          title={part.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {shortLink(part.href)}
        </a>
      );
    })}
  </>
);

export default LinkedText;
