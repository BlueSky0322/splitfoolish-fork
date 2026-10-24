import { findLinks } from '../../utils/text';
import classes from './LinkedText.module.css';

/**
 * Text as typed, with the web addresses in it as links that open in a new tab. A click
 * on one goes nowhere else, so a row or button around the text doesn't open as well.
 */
const LinkedText = ({ text }: { text: string }) => (
  <>
    {findLinks(text).map((part, i) =>
      part.href == null ? (
        part.text
      ) : (
        <a
          key={i}
          className={classes.link}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {part.text}
        </a>
      ),
    )}
  </>
);

export default LinkedText;
