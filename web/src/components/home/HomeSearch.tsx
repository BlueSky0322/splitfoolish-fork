import { Loader, TextInput, UnstyledButton } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { CaretRight, MagnifyingGlass, Receipt } from '@phosphor-icons/react';
import type { SplitSummary } from '@shared/api';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useBackDismiss } from '../../hooks/useBackDismiss';
import { navigate } from '../../hooks/useRoute';
import { categoryIcon } from '../../split/categories';
import { formatAmount } from '../../utils/money';
import { plural } from '../../utils/text';
import SplitAvatar from '../common/SplitAvatar';
import classes from './MobileHome.module.css';

/** Searches start at this many characters, as the server asks */
const MIN_SEARCH = 2;

/** `text` with the part matching `query` picked out */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (query === '' || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className={classes.match}>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/** "Sat 11 Oct" */
const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Search on phones (10n): items across your splits, from the server, and splits by name,
 * from the list already here. Cancel or Back closes it.
 */
const HomeSearch = ({ splits, onClose }: { splits: SplitSummary[]; onClose: () => void }) => {
  const [text, setText] = useState('');
  const query = text.trim();
  const [debounced] = useDebouncedValue(query, 250);
  useBackDismiss(true, onClose);

  const found = useQuery({
    queryKey: ['search', debounced],
    queryFn: async () => (await api.searchItems(debounced)).items,
    enabled: debounced.length >= MIN_SEARCH,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const items = query.length >= MIN_SEARCH ? found.data ?? [] : [];
  const matchingSplits =
    query.length >= MIN_SEARCH
      ? splits.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
      : [];

  return (
    <div className={classes.page}>
      <div className={classes.searchRow}>
        <TextInput
          className="flex-1"
          size="md"
          aria-label="Search"
          placeholder="Search splits and items"
          leftSection={<MagnifyingGlass size={18} />}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          data-autofocus
          autoFocus
          enterKeyHint="search"
          rightSection={found.isFetching ? <Loader size={14} /> : null}
        />
        <UnstyledButton
          className={classes.cancel}
          onClick={onClose}
        >
          Cancel
        </UnstyledButton>
      </div>

      {query.length >= MIN_SEARCH && found.isError && (
        <p className="sf-muted text-sm">Searching items needs a connection.</p>
      )}
      {items.length > 0 && (
        <section>
          <h2 className={classes.sectionLabel}>Items</h2>
          <div className={classes.group}>
            {items.map((item) => {
              const Icon = categoryIcon(item.category) ?? Receipt;
              return (
                <UnstyledButton
                  key={item.id}
                  className={classes.resultRow}
                  onClick={() => navigate(`?s=${item.splitId}`)}
                >
                  <span className={classes.iconTile}>
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={classes.rowName}>
                      <Highlight
                        text={item.name}
                        query={query}
                      />
                    </span>
                    <span className={classes.rowMeta}>
                      {item.splitName}, {shortDate(item.createdAt)}
                    </span>
                  </span>
                  <span className={classes.resultAmount}>
                    {formatAmount(item.costCents, item.currency)}
                  </span>
                </UnstyledButton>
              );
            })}
          </div>
        </section>
      )}
      {matchingSplits.length > 0 && (
        <section>
          <h2 className={classes.sectionLabel}>Splits</h2>
          <div className={classes.group}>
            {matchingSplits.map((split) => (
              <UnstyledButton
                key={split.id}
                className={classes.resultRow}
                onClick={() => navigate(`?s=${split.id}`)}
              >
                <SplitAvatar
                  splitId={split.id}
                  name={split.name}
                  pictureVersion={split.pictureVersion}
                  size={36}
                />
                <span className="min-w-0 flex-1">
                  <span className={classes.rowName}>
                    <Highlight
                      text={split.name}
                      query={query}
                    />
                  </span>
                  <span className={classes.rowMeta}>
                    {plural(split.peopleCount, 'person', 'people')}
                    {split.settled && ', settled'}
                    {split.archived && ', archived'}
                  </span>
                </span>
                <CaretRight
                  size={16}
                  className="sf-muted"
                />
              </UnstyledButton>
            ))}
          </div>
        </section>
      )}
      {query.length >= MIN_SEARCH &&
        found.isSuccess &&
        !found.isPlaceholderData &&
        items.length === 0 &&
        matchingSplits.length === 0 && (
          <p className="sf-muted text-center py-10">Nothing called “{query}”.</p>
        )}
    </div>
  );
};

export default HomeSearch;
