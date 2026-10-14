import { ActionIcon, Button, Menu, SegmentedControl, Title, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CloudCheck,
  CloudSlash,
  DotsThreeOutline,
  GearSix,
  Images,
  LockSimple,
  Plus,
  Rows,
  ShareNetwork,
  SortDescending,
  SignOut,
  StackSimple,
  Table,
  Trash,
  UserPlus,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { ReactNode, useContext, useMemo, useState } from 'react';
import { Attachment, ItemInput } from '../../api';
import { AppContext } from '../../context/AppContext/AppContext';
import { toApiItem } from '../../context/AppContext/app-reducer';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import { updateHomeData, useHomeDataSnapshot } from '../../hooks/useHomeData';
import { navigate } from '../../hooks/useRoute';
import { SplitActionsContext, SyncStatus, newId, useSplit } from '../../hooks/useSplit';
import { IItem, IPerson } from '../../interfaces/app-reducer';
import { findMe, summarise } from '../../split/derive';
import {
  GROUP_LABELS,
  GroupBy,
  MOBILE_SORTS,
  SortDir,
  SortKey,
  groupItems,
} from '../../split/grouping';
import { useProfile } from '../../profile/ProfileContext';
import { currencySymbol } from '../../utils/money';
import ErrorBoundary from '../ErrorBoundary';
import PhotoStrip from '../photos/PhotoStrip';
import { usePhotos } from '../photos/usePhotos';
import EndSplit, { EndSplitTitle } from '../EndSplit';
import ResetLink from '../ResetLink';
import SplitMembers, { ShareTitle } from '../SplitMembers';
import Fab from '../ui/Fab';
import ResponsiveDialog from '../ui/ResponsiveDialog';
import SplitAvatar from '../ui/SplitAvatar';
import StateCard from '../ui/StateCard';
import PersonAvatar, { AvatarVersionsContext } from './PersonAvatar';
import BalancePanel, { BalanceHero } from './BalancePanel';
import ItemForm from './ItemForm';
import { ItemCards, ItemTable } from './ItemViews';
import PeopleSheet from './PeopleSheet';
import ShareImage from './ShareImage';
import SplitSettings from './SplitSettings';
import classes from './Split.module.css';

interface ViewPrefs {
  view: 'card' | 'table';
  groupBy: GroupBy;
  sortKey: SortKey;
  sortDir: SortDir;
}

const DEFAULT_PREFS: ViewPrefs = { view: 'card', groupBy: 'day', sortKey: 'date', sortDir: 'asc' };
const GROUP_ORDER: GroupBy[] = ['none', 'day', 'payer', 'category'];
// Item and payer read best A to Z; amounts largest first
const FIRST_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  payer: 'asc',
  amount: 'desc',
  date: 'asc',
};

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: IItem }
  | { kind: 'people'; personId?: string }
  | { kind: 'settle' }
  | { kind: 'share' }
  | { kind: 'members' }
  | { kind: 'reset' }
  /** fromShare: Cancel goes back to the share dialog it replaced */
  | { kind: 'end'; fromShare?: boolean }
  | { kind: 'settings' }
  | { kind: 'photos' };

const MAX_AVATARS = 4;

function AvatarStack({ people, size, max }: { people: IPerson[]; size: number; max: number }) {
  const shown = people.slice(0, max);
  return (
    <div
      className={classes.avatarStack}
      data-size={size >= 30 ? 'lg' : undefined}
    >
      {shown.map((p) => (
        <PersonAvatar
          key={p.id}
          person={p}
          size={size}
        />
      ))}
      {people.length > max && <span className={classes.moreCount}>+{people.length - max}</span>}
    </div>
  );
}

function SaveStatus({
  status,
  count,
  onRetry,
}: {
  status: SyncStatus;
  count: number;
  onRetry: () => void;
}) {
  if (status === 'error') {
    return (
      <div className={classes.status}>
        <CloudSlash size={14} />
        Not saved yet, retrying ·{' '}
        <button
          type="button"
          className={classes.linkButton}
          onClick={onRetry}
        >
          Retry now
        </button>
      </div>
    );
  }
  const label =
    status === 'loading'
      ? 'Loading'
      : status === 'refreshing'
        ? 'Updating'
        : status === 'saving'
          ? 'Saving'
          : 'Saved';
  return (
    <div className={classes.status}>
      <CloudCheck size={14} />
      {label} · {count} {count === 1 ? 'item' : 'items'}
    </div>
  );
}

/** "Chen and Dev owe you", for the phone's people summary */
function oweLine(people: IPerson[], summary: ReturnType<typeof summarise>, me: IPerson | null) {
  if (!summary.hasItems) return 'No items yet';
  if (me == null) return 'Tap to edit or pick yourself';
  const owe = summary.transfers.filter((t) => t.toId === me.id).map((t) => t.fromId);
  const youOwe = summary.transfers.filter((t) => t.fromId === me.id).map((t) => t.toId);
  const names = (ids: string[]) => {
    const list = ids.map((id) => people.find((p) => p.id === id)?.name ?? '');
    return list.length <= 2
      ? list.join(' and ')
      : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  };
  if (owe.length > 0) return `${names(owe)} ${owe.length === 1 ? 'owes' : 'owe'} you`;
  if (youOwe.length > 0) return `You owe ${names(youOwe)}`;
  return 'Everyone is settled';
}

const SplitScreen = ({ splitId, myEmail }: { splitId: string; myEmail: string | null }) => {
  const { status, meta, setMeta, refreshMeta, actions, retry, whenSaved } = useSplit(splitId);
  const photos = usePhotos({ splitId, meta, setMeta, whenSaved });
  // People can remove photos they added; the owner can remove any
  const canRemovePhoto = (photo: Attachment) =>
    photo.uploadedBy === myEmail || meta?.role === 'owner';
  const { state } = useContext(AppContext);
  const isDesktop = useIsDesktop();
  // How items are shown, saved with the account
  const { profile, updateSettings } = useProfile();
  const settings = profile?.settings;
  const prefs: ViewPrefs = {
    view: settings?.itemsView ?? DEFAULT_PREFS.view,
    groupBy: settings?.itemsGroupBy ?? DEFAULT_PREFS.groupBy,
    sortKey: settings?.itemsSortKey ?? DEFAULT_PREFS.sortKey,
    sortDir: settings?.itemsSortDir ?? DEFAULT_PREFS.sortDir,
  };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const close = () => setDialog(null);
  const photoCounts = new Map<string, number>();
  for (const a of meta?.attachments ?? []) {
    if (a.itemId) photoCounts.set(a.itemId, (photoCounts.get(a.itemId) ?? 0) + 1);
  }
  const splitPhotoCount = meta?.attachments.filter((a) => a.itemId == null).length ?? 0;

  const currency = meta?.currency ?? 'MYR';
  // Shared by everyone in the split; ignored if that person was just removed
  const distributorId = state.people.some((p) => p.id === meta?.distributorId)
    ? meta?.distributorId ?? null
    : null;
  const summary = useMemo(
    () => summarise(state.people, state.items, distributorId),
    [state.people, state.items, distributorId],
  );
  const me = findMe(state.people, myEmail);
  // My splits hears about a new picture first (it may be uploaded from New split)
  const listed = useHomeDataSnapshot().splits?.find((s) => s.id === splitId);
  const pictureVersion = listed ? listed.pictureVersion : meta?.pictureVersion ?? null;
  const avatarVersions = useMemo(
    () => new Map((meta?.members ?? []).map((m) => [m.email, m.avatarVersion])),
    [meta?.members],
  );
  const filterPerson = state.people.find((p) => p.id === personFilter) ?? null;
  const shownItems = filterPerson
    ? state.items.filter(
        (i) =>
          i.payer.id === filterPerson.id || i.participants.some((p) => p.id === filterPerson.id),
      )
    : state.items;
  const groups = groupItems(shownItems, prefs.groupBy, prefs.sortKey, prefs.sortDir);
  const grouped = prefs.groupBy !== 'none';

  if (status === 'notfound') {
    return (
      <StateCard
        icon={<LockSimple size={36} />}
        title="This split doesn't exist, or you don't have access"
        body="If someone shared it with you, they may have removed you."
        action={<Button onClick={() => navigate('')}>Go to My splits</Button>}
      />
    );
  }

  const setPref = (patch: Partial<ViewPrefs>) =>
    updateSettings({
      ...(patch.view && { itemsView: patch.view }),
      ...(patch.groupBy && { itemsGroupBy: patch.groupBy }),
      ...(patch.sortKey && { itemsSortKey: patch.sortKey }),
      ...(patch.sortDir && { itemsSortDir: patch.sortDir }),
    });
  const sortBy = (key: SortKey) =>
    setPref(
      prefs.sortKey === key
        ? { sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortKey: key, sortDir: FIRST_DIR[key] },
    );
  const mobileSort = MOBILE_SORTS.findIndex(
    (s) => s.key === prefs.sortKey && s.dir === prefs.sortDir,
  );
  const cycleMobileSort = () => {
    const next = MOBILE_SORTS[(mobileSort + 1) % MOBILE_SORTS.length];
    setPref({ sortKey: next.key, sortDir: next.dir });
  };
  const cycleGroup = () =>
    setPref({
      groupBy: GROUP_ORDER[(GROUP_ORDER.indexOf(prefs.groupBy) + 1) % GROUP_ORDER.length],
    });

  const deleteItem = (item: IItem, confirmed = false) => {
    const count = photos.photosOf(item.id).length;
    if (count > 0) {
      // Photos are deleted with the item and can't be undone, so ask first
      const remove = () => {
        if (!actions.removeItem(item.id)) return;
        photos.forgetItem(item.id);
        notifications.show({ message: `Deleted ${item.name} and its photos` });
      };
      if (confirmed) {
        remove();
        return;
      }
      modals.openConfirmModal({
        title: `Delete ${item.name}?`,
        children: (
          <p className="text-sm">
            Its {count === 1 ? 'photo' : `${count} photos`} will be deleted too. This can't be
            undone.
          </p>
        ),
        labels: { confirm: 'Delete', cancel: 'Cancel' },
        confirmProps: { color: 'red' },
        onConfirm: remove,
      });
      return;
    }
    const saved = toApiItem(item);
    if (!actions.removeItem(item.id)) return;
    const id = notifications.show({
      message: (
        <div className="flex items-center justify-between gap-3">
          <span>Deleted {item.name}</span>
          <Button
            variant="subtle"
            size="compact-sm"
            onClick={() => {
              actions.restoreItem(saved);
              notifications.hide(id);
            }}
          >
            Undo
          </Button>
        </div>
      ),
      autoClose: 6000,
    });
  };

  const saveItem = (input: ItemInput, newPhotos: File[]) => {
    if (dialog?.kind === 'edit') {
      const ok = actions.updateItem(dialog.item.id, input);
      if (ok) close();
      return ok;
    }
    const id = newId();
    const ok = actions.addItem(input, id);
    if (ok) {
      close();
      if (newPhotos.length > 0) photos.upload(newPhotos, id);
    }
    return ok;
  };

  const openPeople = (personId?: string) => setDialog({ kind: 'people', personId });
  const linkMe = () => openPeople();
  const showItemsOf = (personId: string) => {
    setPersonFilter(personId);
    close();
  };

  const loaded = meta != null;
  const noPeople = loaded && state.people.length === 0;
  const peopleNames = state.people.map((p) => p.name).join(', ');

  const viewToggle = (
    <SegmentedControl
      size="xs"
      value={prefs.view}
      onChange={(v) => setPref({ view: v as ViewPrefs['view'] })}
      data={[
        {
          value: 'card',
          label: (
            <Rows
              size={16}
              aria-label="Card view"
            />
          ),
        },
        {
          value: 'table',
          label: (
            <Table
              size={16}
              aria-label="Table view"
            />
          ),
        },
      ]}
    />
  );

  const moreMenu = (target: ReactNode) => (
    <Menu
      position="bottom-end"
      withinPortal
    >
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<UsersThree size={16} />}
          onClick={() => openPeople()}
        >
          People
        </Menu.Item>
        <Menu.Item
          leftSection={<UserPlus size={16} />}
          onClick={() => setDialog({ kind: 'members' })}
        >
          Share split
        </Menu.Item>
        <Menu.Item
          leftSection={<Images size={16} />}
          onClick={() => setDialog({ kind: 'photos' })}
        >
          Photos
          {splitPhotoCount > 0 && <span className="sf-muted"> ({splitPhotoCount})</span>}
        </Menu.Item>
        <Menu.Item
          leftSection={<GearSix size={16} />}
          onClick={() => setDialog({ kind: 'settings' })}
        >
          Split settings
        </Menu.Item>
        {meta && (
          <>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={meta.role === 'owner' ? <Trash size={16} /> : <SignOut size={16} />}
              onClick={() => setDialog({ kind: 'end' })}
            >
              {meta.role === 'owner' ? 'Delete split' : 'Leave split'}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  const filterChip = filterPerson && (
    <div className={classes.filterChip}>
      Showing {filterPerson.name}'s items
      <ActionIcon
        variant="subtle"
        size={22}
        radius="xl"
        aria-label="Show all items"
        onClick={() => setPersonFilter(null)}
      >
        <X size={12} />
      </ActionIcon>
    </div>
  );

  const banner = status === 'error' && (
    <div className={classes.banner}>
      <CloudSlash size={18} />
      <span className="flex-1">
        Couldn't save your latest changes. They're kept here and we keep retrying.
      </span>
      <Button
        variant="default"
        size="compact-sm"
        onClick={retry}
      >
        Retry now
      </Button>
    </div>
  );

  const list = noPeople ? (
    <div className={classes.empty}>
      <UsersThree
        size={36}
        className={classes.emptyIcon}
      />
      <div className={classes.emptyTitle}>Who's splitting?</div>
      <div className={classes.emptyBody}>Add everyone sharing the costs, including yourself.</div>
      <Button onClick={() => openPeople()}>Add people</Button>
    </div>
  ) : loaded && state.items.length === 0 ? (
    <div className={classes.empty}>
      <div className={classes.emptyTitle}>No items yet</div>
      <div className={classes.emptyBody}>
        Add what was bought and who paid, and the balances work themselves out.
      </div>
      {isDesktop && <Button onClick={() => setDialog({ kind: 'add' })}>Add item</Button>}
    </div>
  ) : prefs.view === 'table' ? (
    <ItemTable
      groups={groups}
      grouped={grouped}
      summary={summary}
      me={me}
      people={state.people}
      currency={currency}
      mobile={!isDesktop}
      onEdit={(item) => setDialog({ kind: 'edit', item })}
      onDelete={deleteItem}
      photoCounts={photoCounts}
      sortKey={prefs.sortKey}
      sortDir={prefs.sortDir}
      onSort={sortBy}
      totalCents={groups.reduce((sum, g) => sum + g.subtotalCents, 0)}
    />
  ) : (
    <ItemCards
      groups={groups}
      grouped={grouped}
      summary={summary}
      me={me}
      people={state.people}
      currency={currency}
      mobile={!isDesktop}
      onEdit={(item) => setDialog({ kind: 'edit', item })}
      onDelete={deleteItem}
      photoCounts={photoCounts}
    />
  );

  const panel = (
    <BalancePanel
      people={state.people}
      summary={summary}
      currency={currency}
      me={me}
      distributorId={distributorId}
      onDistributorChange={(id) => actions.setDistributor(id)}
      onShareImage={() => setDialog({ kind: 'share' })}
      onLinkMe={linkMe}
      members={meta?.members ?? []}
      variant={isDesktop ? 'panel' : 'sheet'}
    />
  );

  const dialogs = (
    <>
      <ResponsiveDialog
        opened={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        onClose={close}
        title={dialog?.kind === 'edit' ? 'Edit item' : 'Add item'}
        width={520}
      >
        {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
          <ItemForm
            key={dialog.kind === 'edit' ? dialog.item.id : 'new'}
            people={state.people}
            currency={currency}
            item={dialog.kind === 'edit' ? dialog.item : undefined}
            defaultPayerId={me?.id}
            splitId={splitId}
            onSave={saveItem}
            photos={dialog.kind === 'edit' ? photos.photosOf(dialog.item.id) : []}
            uploading={dialog.kind === 'edit' ? photos.uploading[dialog.item.id] ?? [] : []}
            canRemovePhoto={canRemovePhoto}
            onAddPhotos={(files) => dialog.kind === 'edit' && photos.upload(files, dialog.item.id)}
            onRemovePhoto={photos.remove}
            onDelete={
              dialog.kind === 'edit'
                ? () => {
                    close();
                    deleteItem(dialog.item, true);
                  }
                : undefined
            }
            onCancel={close}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'people'}
        onClose={close}
        title="People"
        width={520}
      >
        {dialog?.kind === 'people' && (
          <PeopleSheet
            state={state}
            summary={summary}
            currency={currency}
            myEmail={myEmail}
            members={meta?.members ?? []}
            invites={meta?.invites ?? []}
            isOwner={meta?.role === 'owner'}
            initialPersonId={dialog.personId}
            onShowItems={showItemsOf}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'settle'}
        onClose={close}
        title={
          <BalanceHero
            summary={summary}
            currency={currency}
            me={me}
            onLinkMe={linkMe}
            size={36}
            prefix="Settle up"
          />
        }
      >
        <div className="sf-muted text-sm mb-4">
          {summary.transfers.length === 0
            ? summary.hasItems
              ? 'Everyone is settled up'
              : 'No items yet'
            : `${summary.transfers.length} ${
                summary.transfers.length === 1 ? 'transfer clears' : 'transfers clear'
              } every balance`}
        </div>
        {panel}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'share'}
        onClose={close}
        title="Share as image"
        width={520}
      >
        {dialog?.kind === 'share' && meta && (
          <ShareImage
            name={meta.name}
            currency={currency}
            people={state.people}
            items={state.items}
            summary={summary}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'members'}
        onClose={close}
        title={<ShareTitle name={meta?.name ?? ''} />}
        width={460}
      >
        {dialog?.kind === 'members' && myEmail && meta && (
          <SplitMembers
            meta={meta}
            myEmail={myEmail}
            onChange={refreshMeta}
            setMeta={setMeta}
            onReset={() => setDialog({ kind: 'reset' })}
            onEnd={() => setDialog({ kind: 'end', fromShare: true })}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'reset'}
        onClose={() => setDialog({ kind: 'members' })}
        title="Reset share link?"
        width={400}
      >
        {dialog?.kind === 'reset' && (
          <ResetLink
            splitId={splitId}
            onDone={() => {
              refreshMeta();
              setDialog({ kind: 'members' });
            }}
            onCancel={() => setDialog({ kind: 'members' })}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'end'}
        onClose={close}
        title={<EndSplitTitle isOwner={meta?.role === 'owner'} />}
        width={420}
      >
        {dialog?.kind === 'end' && myEmail && meta && (
          <EndSplit
            splitId={splitId}
            name={meta.name}
            isOwner={meta.role === 'owner'}
            myEmail={myEmail}
            onCancel={() => (dialog.fromShare ? setDialog({ kind: 'members' }) : close())}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'photos'}
        onClose={close}
        title="Photos"
        width={560}
      >
        {dialog?.kind === 'photos' && (
          <div className="flex flex-col gap-3">
            <p className="sf-muted text-sm">
              Photos of the trip or anything else for everyone in the split. Receipts for an item
              are added on the item.
            </p>
            <PhotoStrip
              splitId={splitId}
              photos={photos.photosOf(null)}
              uploading={photos.uploading[''] ?? []}
              canRemove={canRemovePhoto}
              onAdd={(files) => photos.upload(files, null)}
              onRemove={photos.remove}
              layout="gallery"
            />
          </div>
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'settings'}
        onClose={close}
        title="Split settings"
      >
        {dialog?.kind === 'settings' && meta && (
          <SplitSettings
            splitId={splitId}
            name={meta.name}
            currency={meta.currency}
            pictureVersion={pictureVersion}
            canEdit={meta.role === 'owner'}
            onSaved={(changes) => {
              setMeta((m) => (m ? { ...m, ...changes } : m));
              updateHomeData((data) => ({
                splits: data.splits?.map((x) => (x.id === splitId ? { ...x, ...changes } : x)),
              }));
            }}
            onClose={close}
          />
        )}
      </ResponsiveDialog>
    </>
  );

  if (isDesktop) {
    return (
      <SplitActionsContext.Provider value={actions}>
        <AvatarVersionsContext.Provider value={avatarVersions}>
          <div className={classes.desktop}>
            <div className={classes.main}>
              <div className={classes.titleRow}>
                <div className={classes.titleBlock}>
                  <div className={classes.title}>
                    {meta && (
                      <SplitAvatar
                        splitId={splitId}
                        name={meta.name}
                        pictureVersion={pictureVersion}
                        size={40}
                      />
                    )}
                    <Title order={2}>{meta?.name ?? ' '}</Title>
                    {meta && (
                      <span className="sf-tag">
                        {currency} · {currencySymbol(currency)}
                      </span>
                    )}
                  </div>
                  <SaveStatus
                    status={status}
                    count={state.items.length}
                    onRetry={retry}
                  />
                </div>
                <div className={classes.actions}>
                  <Button
                    variant="default"
                    leftSection={<ShareNetwork size={16} />}
                    onClick={() => setDialog({ kind: 'members' })}
                    disabled={!loaded || myEmail == null}
                  >
                    Share
                  </Button>
                  {moreMenu(
                    <ActionIcon
                      variant="default"
                      size={36}
                      aria-label="More"
                    >
                      <DotsThreeOutline size={16} />
                    </ActionIcon>,
                  )}
                  <Button
                    leftSection={<Plus size={16} />}
                    onClick={() => setDialog({ kind: 'add' })}
                    disabled={!loaded || state.people.length === 0}
                  >
                    Add item
                  </Button>
                </div>
              </div>

              {state.people.length > 0 && (
                <div className={classes.peopleLine}>
                  <AvatarStack
                    people={state.people}
                    size={26}
                    max={6}
                  />
                  <span className={classes.peopleNames}>{peopleNames}</span>
                  <button
                    type="button"
                    className={classes.linkButton}
                    onClick={() => openPeople()}
                  >
                    {meta?.role === 'owner' ? 'Edit people' : 'See people'}
                  </button>
                </div>
              )}

              {banner}

              {!noPeople && state.items.length > 0 && (
                <div className={classes.toolbar}>
                  <Menu
                    position="bottom-start"
                    withinPortal
                  >
                    <Menu.Target>
                      <Button
                        variant="subtle"
                        color="gray"
                        leftSection={<StackSimple size={16} />}
                        rightSection={<CaretDown size={12} />}
                      >
                        {GROUP_LABELS[prefs.groupBy]}
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {GROUP_ORDER.map((g) => (
                        <Menu.Item
                          key={g}
                          onClick={() => setPref({ groupBy: g })}
                          color={g === prefs.groupBy ? 'accent' : undefined}
                        >
                          {GROUP_LABELS[g]}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                  {filterChip}
                  <span className={classes.toolbarSpacer} />
                  {viewToggle}
                </div>
              )}

              <ErrorBoundary fallback={<div>Something went wrong showing the items.</div>}>
                {list}
              </ErrorBoundary>
            </div>
            <aside className={classes.aside}>{panel}</aside>
          </div>
          {dialogs}
        </AvatarVersionsContext.Provider>
      </SplitActionsContext.Provider>
    );
  }

  const shownSort = MOBILE_SORTS[mobileSort] ?? MOBILE_SORTS[0];

  return (
    <SplitActionsContext.Provider value={actions}>
      <AvatarVersionsContext.Provider value={avatarVersions}>
        <div className={classes.mobile}>
          <div className={classes.topBar}>
            <Button
              variant="subtle"
              color="gray"
              leftSection={<CaretLeft size={16} />}
              onClick={() => navigate('')}
            >
              Splits
            </Button>
            <div className="flex gap-1">
              <ActionIcon
                variant="subtle"
                color="gray"
                size={44}
                aria-label="Share split"
                onClick={() => setDialog({ kind: 'members' })}
                disabled={!loaded || myEmail == null}
              >
                <ShareNetwork size={20} />
              </ActionIcon>
              {moreMenu(
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={44}
                  aria-label="More"
                >
                  <DotsThreeOutline size={20} />
                </ActionIcon>,
              )}
            </div>
          </div>

          <div className={classes.mobileHero}>
            {meta && (
              <SplitAvatar
                splitId={splitId}
                name={meta.name}
                pictureVersion={pictureVersion}
                size={40}
              />
            )}
            <BalanceHero
              summary={summary}
              currency={currency}
              me={me}
              onLinkMe={linkMe}
              size={40}
              prefix={meta?.name}
            />
            <div className={classes.heroButtons}>
              <Button
                onClick={() => setDialog({ kind: 'settle' })}
                disabled={noPeople || !loaded}
              >
                Settle up
              </Button>
              <Button
                variant="default"
                onClick={() => setDialog({ kind: 'share' })}
                disabled={!summary.hasItems}
              >
                Share image
              </Button>
            </div>
            <SaveStatus
              status={status}
              count={state.items.length}
              onRetry={retry}
            />
          </div>

          {state.people.length > 0 && (
            <UnstyledButton
              className={classes.peopleSummary}
              onClick={() => openPeople()}
            >
              <AvatarStack
                people={state.people}
                size={30}
                max={MAX_AVATARS}
              />
              <div className={classes.peopleSummaryText}>
                <div className={classes.peopleSummaryTitle}>
                  {state.people.length} {state.people.length === 1 ? 'person' : 'people'}
                </div>
                <div className={classes.peopleSummarySub}>{oweLine(state.people, summary, me)}</div>
              </div>
              <CaretRight size={16} />
            </UnstyledButton>
          )}

          {banner}

          {!noPeople && state.items.length > 0 && (
            <div className={classes.toolbar}>
              <UnstyledButton
                className={classes.pill}
                onClick={cycleGroup}
              >
                <StackSimple size={14} />
                {GROUP_LABELS[prefs.groupBy]}
              </UnstyledButton>
              <UnstyledButton
                className={classes.pill}
                onClick={cycleMobileSort}
              >
                <SortDescending size={14} />
                {shownSort.label}
              </UnstyledButton>
              <span className={classes.toolbarSpacer} />
              {viewToggle}
            </div>
          )}
          {filterChip}

          <ErrorBoundary fallback={<div>Something went wrong showing the items.</div>}>
            {list}
          </ErrorBoundary>
        </div>
        {!noPeople && loaded && (
          <Fab
            label="Add item"
            onClick={() => setDialog({ kind: 'add' })}
          />
        )}
        {dialogs}
      </AvatarVersionsContext.Provider>
    </SplitActionsContext.Provider>
  );
};

export default SplitScreen;
