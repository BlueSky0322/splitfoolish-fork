import { UnstyledButton } from '@mantine/core';
import { Camera, Images } from '@phosphor-icons/react';
import ResponsiveDialog from '../../ui/ResponsiveDialog';
import classes from './AddPhotosSheet.module.css';

/** The two ways to add photos on a phone: take one now, or choose from the library */
const AddPhotosSheet = ({
  opened,
  title = 'Add photos',
  onClose,
  onTakePhoto,
  onChooseFromLibrary,
}: {
  opened: boolean;
  title?: string;
  onClose: () => void;
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
}) => {
  // The sheet closes as the camera or library opens
  const choose = (pick: () => void) => {
    onClose();
    pick();
  };
  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      title={title}
      width={400}
    >
      <div className={classes.choices}>
        <UnstyledButton
          className={classes.choice}
          onClick={() => choose(onTakePhoto)}
        >
          <span className={classes.icon}>
            <Camera size={20} />
          </span>
          <span className={classes.text}>
            <span className={classes.title}>Take photo</span>
            <span className={classes.hint}>Opens the camera</span>
          </span>
        </UnstyledButton>
        <UnstyledButton
          className={classes.choice}
          onClick={() => choose(onChooseFromLibrary)}
        >
          <span className={classes.icon}>
            <Images size={20} />
          </span>
          <span className={classes.text}>
            <span className={classes.title}>Choose from library</span>
            <span className={classes.hint}>Pick one or several</span>
          </span>
        </UnstyledButton>
      </div>
    </ResponsiveDialog>
  );
};

export default AddPhotosSheet;
