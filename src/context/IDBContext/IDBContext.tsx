import { ReactNode, createContext, useEffect, useState } from 'react';

interface IDBContextValue {
  db?: IDBDatabase;
}

export const IDBContext = createContext<IDBContextValue>({} as IDBContextValue);

interface IDBContextProviderProps {
  children: ReactNode;
  dbName: string;
  version?: number;
  schema: { [storeName: string]: IDBObjectStoreParameters };
  indexes?: {
    [storeName: string]: {
      name: string;
      keyPath: string | string[];
      options: IDBIndexParameters;
    }[];
  };
  upgradeStrategy?: (ev: Event) => void;
}

export const IDBContextProvider: React.FC<IDBContextProviderProps> = ({
  children,
  dbName,
  version = 1,
  schema,
  indexes = {},
  upgradeStrategy,
}) => {
  const [db, setDb] = useState<IDBDatabase>();

  useEffect(() => {
    if (db != null) {
      db.close();
      console.log('IDBContextProvider: Closing connection');
    }

    const req = window.indexedDB.open(dbName, version);

    req.onsuccess = (ev: Event) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      setDb(db);
      console.log(`IDBContextProvider: Successfully opened connection to '${dbName}' v${version}`);
    };

    req.onerror = (ev: Event) => {
      console.error(ev);
    };

    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;

      Object.keys(schema).forEach((storeName) => {
        const store = db.createObjectStore(storeName, schema[storeName]);

        const index = indexes[storeName];
        if (index != null) {
          indexes[storeName].forEach((ix) => {
            store.createIndex(ix.name, ix.keyPath, ix.options);
          });
        }
      });

      // {
      //   // syncing stuff, not sure if needed
      //   console.log(`IDBContextProvider: Syncing schema...`);
      //   const diff: { add: string[]; remove: string[] } = {
      //     add: [...Object.keys(schema)],
      //     remove: [],
      //   };

      //   for (let i = 0; i < db.objectStoreNames.length; i++) {
      //     const storeName = db.objectStoreNames.item(i)!;

      //     const existingIndex = diff.add.indexOf(storeName);
      //     if (existingIndex === -1) {
      //       diff.remove.push(storeName);
      //       diff.add.splice(existingIndex, 1);
      //       continue;
      //     }
      //   }
      // }

      if (upgradeStrategy == null) {
        console.warn(
          'IDBContextProvider: `upgradeStrategy` not provided, ensure upgrades are handled once there are schema changes or risk losing data.',
        );
        return;
      }

      upgradeStrategy(ev);
    };

    return () => {
      if (db != null) {
        db.close();
        console.log('IDBContextProvider: Closing connection');
      }
    };
  }, [schema]);

  return <IDBContext.Provider value={{ db }}>{children}</IDBContext.Provider>;
};
