import { Drawer, Modal } from '@mantine/core';
import { ReactNode } from 'react';
import { useIsMobile } from '../../hooks/useBreakpoints';
import classes from './ResponsiveDialog.module.css';

interface ResponsiveDialogProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Width of the desktop dialog */
  width?: number;
}

// One form, two shapes: a bottom sheet on phones and a centred dialog elsewhere
const ResponsiveDialog = ({
  opened,
  onClose,
  title,
  children,
  width = 440,
}: ResponsiveDialogProps) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        opened={opened}
        onClose={onClose}
        position="bottom"
        size="auto"
        title={title}
        classNames={{
          content: classes.sheet,
          header: classes.sheetHeader,
          title: classes.sheetTitle,
          body: classes.sheetBody,
        }}
      >
        {children}
      </Drawer>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={width}
      centered
      classNames={{ title: classes.title, body: classes.modalBody }}
    >
      {children}
    </Modal>
  );
};

export default ResponsiveDialog;
