import { faAngleDown, faAngleUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useState } from 'react';
import Drawer from '../../Drawer';
import RadioInput from '../../RadioInput';
import { OptionProps, RadioInputProps } from '../../RadioInput/RadioInput';

import './SelectInput.scss';

type GetString<T> = (item: T | undefined) => string;
interface SelectedComponentProps<T> {
  value: T | undefined;
  getSelectedText: GetString<T>;
}
function DefaultSelectedComponent<T>({
  value,
  getSelectedText,
}: SelectedComponentProps<T>) {
  return <>{getSelectedText(value)}</>;
}

interface SelectOptionsProps<T> extends OptionProps<T> {
  getLabel: GetString<T>;
  getDescription: GetString<T>;
}

function DefaultOptionComponent<T>({
  option,
  getLabel,
  getDescription,
}: SelectOptionsProps<T>) {
  const label = getLabel(option) ?? '';
  const description = getDescription(option) ?? '';
  return (
    <>
      <div className="label mr-auto">{label}</div>
      <div
        className={['description', !description && 'hide', 'ml-auto']
          .filter(Boolean)
          .join(' ')}
      >
        {description}
      </div>
    </>
  );
}

interface SelectInputProps<T> extends RadioInputProps<T> {
  SelectedComponent?: React.ComponentType<SelectedComponentProps<T>>;
  getSelectedText?: GetString<T>;
  getLabel?: GetString<T>;
  getDescription?: GetString<T>;
}

function defaultGetLabelText<T>(item: T) {
  return (item as unknown as { label: string })?.['label'] || '';
}

function defaultGetDescriptionText<T>(item: T) {
  return (item as unknown as { description: string })?.['description'] || '';
}

export default function SelectInput<T>({
  className,
  SelectedComponent = DefaultSelectedComponent,
  getLabel = defaultGetLabelText,
  getDescription = defaultGetDescriptionText,
  getSelectedText = getLabel,
  list,
  value,
  ...radioInputProps
}: SelectInputProps<T>) {
  const selectedItem = list.find((item) => item === value);
  const [expanded, setExpanded] = useState(false);
  const toggleExpand = useCallback(
    () => setExpanded((expanded) => !expanded),
    []
  );
  return (
    <div className={['select-input', className].filter(Boolean).join(' ')}>
      <button
        className="select-input-selection row flex-centered"
        type="button"
        onClick={toggleExpand}
      >
        <div className="col mr-auto">
          <SelectedComponent
            value={selectedItem}
            getSelectedText={getSelectedText}
          />
        </div>
        <div className="col ml-auto flex-centered">
          <FontAwesomeIcon icon={!expanded ? faAngleDown : faAngleUp} />
        </div>
      </button>
      <Drawer containerClassName="select-input-options" expanded={expanded}>
        <RadioInput<T>
          inputType="checkbox"
          className="select-input-group"
          OptionContainerComponent={({ children }) => (
            <div className="select-input-option">{children}</div>
          )}
          // set default OptionComponent to use getters
          OptionComponent={useCallback(
            (optionComponentProps: OptionProps<T>) => (
              <DefaultOptionComponent
                {...optionComponentProps}
                getLabel={getLabel}
                getDescription={getDescription}
              />
            ),
            [getLabel, getDescription]
          )}
          onClick={() => setExpanded(false)}
          // allow overwriting with custom components
          {...radioInputProps}
          list={list}
          value={value}
        />
      </Drawer>
    </div>
  );
}
