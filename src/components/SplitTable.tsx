import { Table } from '@mantine/core';
import { IOwing } from '../interfaces/app-reducer';

interface SplitTableProps {
  owings: IOwing[];
}

const SplitTable = ({ owings }: SplitTableProps) => {
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Payer</Table.Th>
          <Table.Th className="text-right">Amount</Table.Th>
          <Table.Th>Payee</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {owings.length === 0 ? (
          <Table.Tr>
            <Table.Td
              className="text-center text-gray-400"
              colSpan={5}
            >
              There are no items to show.
            </Table.Td>
          </Table.Tr>
        ) : null}
        {owings.map((o, ix) => (
          <Table.Tr key={ix}>
            <Table.Td>{o.payer.name}</Table.Td>
            <Table.Td
              className="font-mono whitespace-nowrap"
              align="right"
            >
              RM {o.amount.toFixed(2)}
            </Table.Td>
            <Table.Td>{o.payee.name}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};

export default SplitTable;
