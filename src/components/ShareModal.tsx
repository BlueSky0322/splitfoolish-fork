import { Title } from '@mantine/core';
import html2canvas from 'html2canvas';
import { useEffect, useRef } from 'react';
import { IOwing } from '../interfaces/app-reducer';
import ItemTable from './ItemTable';
import SplitTable from './SplitTable';

interface ShareModalProps {
  owings: IOwing[];
}

const ShareModal = ({ owings }: ShareModalProps) => {
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (owings == null || shareRef.current == null) return;

    html2canvas(shareRef.current).then((canvas) => {
      canvas.toBlob(async (blob) => {
        if (navigator.share && blob !== null) {
          try {
            const data = {
              files: [
                new File([blob], `splitfoolish-${Date.now()}.png`, {
                  type: 'image/png',
                }),
              ],
            };

            if (navigator.canShare(data)) {
              await navigator.share(data);
            } else {
              console.error('Unable to share settlements.');
            }
          } catch (err) {
            console.error(`Error sharing the div: ${err}`);
          }
        } else {
          alert('Sharing is not supported in this browser');
        }
      }, 'image/png');
    });
  }, []);

  return (
    <div className="overflow-auto">
      <div
        ref={shareRef}
        className="p-4 min-w-[550px]"
      >
        <Title
          className="mb-4"
          order={2}
        >
          Items
        </Title>
        <ItemTable
          showActions={false}
          alwaysShowParticipants={true}
        />
        <Title
          className="mb-4 mt-6"
          order={2}
        >
          Split
        </Title>
        <SplitTable owings={owings} />
      </div>
    </div>
  );
};

export default ShareModal;
