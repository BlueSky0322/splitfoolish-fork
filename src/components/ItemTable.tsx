import { ActionIcon, Table, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconEdit, IconMinus } from '@tabler/icons-react';
import { useContext } from 'react';
import { AppContext } from '../context/AppContext/AppContext';
import { cn } from '../utils/cn';
import EditItemModal from './EditItemModal';

interface ItemTableProps {
  showActions?: boolean;
  alwaysShowParticipants?: boolean;
}
const ItemTable = ({ showActions = true, alwaysShowParticipants = false }: ItemTableProps) => {
  const maxShownParticipants = alwaysShowParticipants ? 9999 : 3;
  const { state, dispatch } = useContext(AppContext);

  const handleItemRemove = (ix: number) => {
    dispatch({ type: 'REMOVE_ITEM', payload: ix });
  };

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Item</Table.Th>
          <Table.Th className="text-right">Cost</Table.Th>
          <Table.Th>Paid by</Table.Th>
          <Table.Th
            className={cn({
              'hidden md:table-cell': !alwaysShowParticipants,
              'table-cell': alwaysShowParticipants,
            })}
          >
            Participants
          </Table.Th>
          <Table.Th className={cn({ hidden: !showActions })}></Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {state.items.length === 0 ? (
          <Table.Tr>
            <Table.Td
              className="text-center text-gray-400"
              colSpan={5}
            >
              There are no items to show.
            </Table.Td>
          </Table.Tr>
        ) : null}
        {state.items.map((i, ix) => (
          <Table.Tr key={ix}>
            <Table.Td className="whitespace-nowrap">{i.name}</Table.Td>
            <Table.Td
              align="right"
              className="font-mono whitespace-nowrap"
            >
              RM {i.cost.toFixed(2)}
            </Table.Td>
            <Table.Td>{i.payer.name}</Table.Td>
            <Table.Td
              className={cn({
                'hidden md:table-cell': !alwaysShowParticipants,
                'table-cell': alwaysShowParticipants,
              })}
            >
              <span>
                {i.participants
                  .slice(0, maxShownParticipants)
                  .map((p) => p.name)
                  .join(', ')}{' '}
                {i.participants.length > maxShownParticipants ? (
                  <Tooltip
                    label={i.participants
                      .slice(maxShownParticipants)
                      .map((p) => p.name)
                      .join(', ')}
                  >
                    <span className="text-blue-900 underline">
                      and {i.participants.length - maxShownParticipants} others
                    </span>
                  </Tooltip>
                ) : null}
              </span>
            </Table.Td>
            <Table.Td className={cn({ hidden: !showActions })}>
              <div className="flex gap-2">
                <ActionIcon>
                  <IconEdit
                    onClick={() => {
                      modals.open({
                        title: 'Edit Item',
                        children: (
                          <EditItemModal
                            item={i}
                            itemIndex={ix}
                          />
                        ),
                      });
                    }}
                  />
                </ActionIcon>
                <ActionIcon color="red">
                  <IconMinus onClick={() => handleItemRemove(ix)} />
                </ActionIcon>
              </div>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
      <Table.Tfoot className="border-double border-t-4">
        <Table.Tr>
          <Table.Td></Table.Td>
          <Table.Td
            className="font-bold font-mono whitespace-nowrap"
            align="right"
          >
            RM {state.items.reduce((sum, o) => sum + o.cost, 0).toFixed(2)}
          </Table.Td>
          <Table.Td></Table.Td>
          <Table.Td
            className={cn({
              'hidden md:table-cell': !alwaysShowParticipants,
              'table-cell': alwaysShowParticipants,
            })}
          ></Table.Td>
          <Table.Td className={cn({ hidden: !showActions })}></Table.Td>
        </Table.Tr>
      </Table.Tfoot>
    </Table>
  );
};

export default ItemTable;
