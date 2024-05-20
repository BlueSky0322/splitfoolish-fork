import { useContext } from 'react';
import { IDBContext } from './IDBContext';

export const useIndexedDb = () => {
  const { db } = useContext(IDBContext);

  const getObjectStore = (
    storeName: string,
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ) => {
    if (db == null) {
      throw Error('IDBDatabase: Database is not initialised.');
    }
    return db.transaction(storeName, mode, options).objectStore(storeName);
  };

  return { db, getObjectStore };
};
