import { List } from '@mantine/core';
import { IOwing } from '../interfaces/app-reducer';

interface SplitTableProps {
  owings: IOwing[];
}

const SplitTable = ({ owings }: SplitTableProps) => {
  return (
    <List>
      {owings.map((o, ix) => (
        <List.Item key={ix}>
          <strong>{o.payer.name}</strong> pays{' '}
          <span className="font-mono font-bold">RM {o.amount.toFixed(2)}</span> to{' '}
          <strong>{o.payee.name}</strong>
        </List.Item>
      ))}
    </List>
  );
};

export default SplitTable;
