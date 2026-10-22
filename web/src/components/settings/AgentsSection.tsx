import { Button } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ConnectedAgent } from '@shared/api';
import { api } from '../../api';
import { showError } from '../../utils/notify';
import ResponsiveDialog from '../ui/ResponsiveDialog';
import SettingsCard from './SettingsCard';
import classes from './SettingsLayout.module.css';

const AGENTS_KEY = ['connected-agents'];

/** What it was allowed, in the words the consent page used */
const describeScopes = (agent: ConnectedAgent) =>
  agent.scopes.includes('splits:write')
    ? 'Can see and change your splits'
    : agent.scopes.includes('splits:read')
      ? 'Can see your splits'
      : 'Can do nothing yet';

const connectedOn = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Connected agents: the AI apps this account let see or change its splits (over MCP),
// each disconnected on its own. Nothing else shows them, so they're read and ended here.
const AgentsSection = () => {
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: AGENTS_KEY, queryFn: api.listAgents });
  const [asking, setAsking] = useState<ConnectedAgent | null>(null);
  const [ending, setEnding] = useState(false);

  const disconnect = async (agent: ConnectedAgent) => {
    setEnding(true);
    try {
      await api.disconnectAgent(agent.id);
      // Gone from the list at once, then as the server has it
      queryClient.setQueryData<ConnectedAgent[]>(AGENTS_KEY, (list) =>
        list?.filter((a) => a.id !== agent.id),
      );
      void queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
      setAsking(null);
    } catch (err) {
      showError(err, `Could not disconnect ${agent.name}`);
    } finally {
      setEnding(false);
    }
  };

  const list = agents.data ?? [];
  return (
    <>
      <SettingsCard
        title="Connected agents"
        help="AI apps you let into your splits. Disconnecting one stops it straight away."
        flush
      >
        {agents.isPending ? (
          <p className={classes.listNote}>Getting your agents…</p>
        ) : agents.isError ? (
          <p className={classes.listNote}>Couldn't get your agents right now.</p>
        ) : list.length === 0 ? (
          <p className={classes.listNote}>No agents are connected.</p>
        ) : (
          <ul
            className={classes.rateList}
            aria-label="Connected agents"
          >
            {list.map((agent) => (
              <li
                key={agent.id}
                className={classes.agentRow}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{agent.name}</div>
                  <div className={classes.agentDetail}>
                    {describeScopes(agent)} · since {connectedOn(agent.connectedAt)}
                  </div>
                </div>
                <Button
                  variant="default"
                  size="compact-sm"
                  onClick={() => setAsking(agent)}
                  aria-label={`Disconnect ${agent.name}`}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      <ResponsiveDialog
        opened={asking != null}
        onClose={() => setAsking(null)}
        title={asking ? `Disconnect ${asking.name}?` : ''}
        width={400}
      >
        <div className="flex flex-col gap-4">
          <p className="sf-muted text-sm">
            It loses access to your splits straight away. To use it again, connect it again and
            allow it on the sign-in page.
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="default"
              onClick={() => setAsking(null)}
            >
              Keep it
            </Button>
            <Button
              color="red"
              loading={ending}
              onClick={() => asking && void disconnect(asking)}
            >
              Disconnect
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </>
  );
};

export default AgentsSection;
