import {
  ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import './RadioButtonGroupInput.scss';

function useSelectedButtonBackgroundMove<T extends string | number>(
  value: T
): [
  (ref: HTMLButtonElement | null) => void,
  (value: T) => (ref: HTMLButtonElement | null) => void
] {
  const [movingButton, setMovingButton] = useState<HTMLButtonElement | null>();
  const movingButtonRef = useCallback(
    (ref: HTMLButtonElement | null) => setMovingButton(ref),
    []
  );

  const [refsByValue, setRefsByValue] = useState<{
    [value in T]?: HTMLElement | null;
  }>({});

  const createRefForValue = useCallback((value: T) => {
    return (ref: HTMLButtonElement | null) => {
      setRefsByValue((refs) => {
        // update element refs only if they have changed
        if (ref && ref !== refs[value]) {
          return { ...refs, [value]: ref };
        }
        return refs;
      });
    };
  }, []);

  const updateValue = useCallback(
    (newValue?: T) => {
      const targetButton = refsByValue[newValue || value];
      if (movingButton && targetButton) {
        movingButton.style.width = `${targetButton.offsetWidth}px`;
        movingButton.style.left = `${targetButton.offsetLeft}px`;
        if (newValue !== undefined) {
          movingButton.classList.add('transition-ready');
        } else {
          movingButton?.classList.remove('transition-ready');
        }
      }
    },
    [value, refsByValue, movingButton]
  );

  const lastValue = useRef<T>(value);
  // update button size on *any* paint frame to catch button resizing
  useLayoutEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value;
      updateValue(value);
    } else {
      // todo: this has been changed to allow rerendering changed components to cause an animation
      // this has however caused the animation to start on component creation
      updateValue(value);
    }
  });

  return [movingButtonRef, createRefForValue];
}

interface Props<T extends string | number> {
  className?: string;
  buttonClassName?: string;
  values: { [value in T]: ReactNode } | Map<T, ReactNode> | T[];
  value: T;
  onChange: (value: T) => void;
}

export default function RadioButtonGroupInput<T extends string | number>({
  className,
  buttonClassName,
  values = [],
  value,
  onChange,
}: Props<T>) {
  const [movingAssetRef, createRefForValue] =
    useSelectedButtonBackgroundMove<T>(value);
  const entries = useMemo(() => {
    return Array.isArray(values)
      ? values.map<[T, string]>((value) => [value, `${value}`])
      : values instanceof Map
      ? Array.from(values.entries())
      : (Object.entries(values).map(([value, description]) => [
          value,
          description,
        ]) as [T, string][]);
  }, [values]);
  const selectedIndex = entries.findIndex(
    ([entryValue]) => entryValue === value
  );
  const includedIndexes = useMemo(() => {
    return (
      entries
        .map((_, index, entries) => {
          // cumulate weightings
          let result = 0;
          // weight start of list
          if (index < 5) {
            result += 5 - index;
          }
          // weight end of list
          if (index >= entries.length - 5) {
            result += 5 - (entries.length - 1 - index);
          }
          // weight to left near selection
          if (index >= selectedIndex - 4 && index <= selectedIndex) {
            result += 5 - (selectedIndex - index);
          }
          // weight to right near selection
          if (index >= selectedIndex && index <= selectedIndex + 4) {
            result += 5 - (index - selectedIndex);
          }
          return [index, result];
        })
        // get most weighted indexes
        .sort((a, b) => b[1] - a[1])
        // truncated to top 10
        .slice(0, 10)
        // get just the indexes, remove the weightings
        .map((a) => a[0])
        // sort indexes in order
        .sort((a, b) => a - b)
    );
  }, [entries, selectedIndex]);

  return (
    <div
      className={['radio-button-group-switch', className]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className={['button moving-background', buttonClassName]
          .filter(Boolean)
          .join(' ')}
        disabled
        ref={movingAssetRef}
      />
      {entries.flatMap(([entryValue, description], index, entries) => {
        const previousIndex = includedIndexes.includes(index - 1);
        const currentIndex = includedIndexes.includes(index);
        const nextIncludedIndex = includedIndexes.indexOf(index - 1) + 1;
        const nextAverageIndex = Math.floor(
          (includedIndexes[nextIncludedIndex] + index) / 2
        );
        const nextAverageKey = entries[nextAverageIndex][0];

        return currentIndex ? (
          // include button
          <button
            key={entryValue}
            type="button"
            className={['button non-moving', buttonClassName]
              .filter(Boolean)
              .join(' ')}
            ref={createRefForValue(entryValue)}
            onClick={() => onChange(entryValue)}
          >
            {description}
          </button>
        ) : previousIndex ? (
          // button is not included and button before this was included
          <button
            key={nextAverageKey}
            type="button"
            className={['button non-moving', buttonClassName]
              .filter(Boolean)
              .join(' ')}
            ref={createRefForValue(nextAverageKey)}
            onClick={() => onChange(nextAverageKey)}
          >
            …
          </button>
        ) : (
          // button is not included and button before this was also not included (ignore)
          []
        );
      })}
    </div>
  );
}
