import React, { forwardRef } from 'react';
import { Pressable as NativePressable, PressableProps, View } from 'react-native';

export const HoverablePressable = forwardRef<View, PressableProps>(
  ({ style, ...props }, ref) => {
    return (
      <NativePressable
        ref={ref}
        {...props}
        {...(props as any).title ? { accessibilityLabel: (props as any).title } : {}}
        style={(state) => {
          const { pressed, hovered } = state as any;
          const isFunction = typeof style === 'function';
          const baseStyle = isFunction ? style(state) : style;

          return [
            baseStyle,
            hovered && { opacity: 0.92 },
            pressed && { opacity: 0.72 },
          ];
        }}
      />
    );
  }
);
HoverablePressable.displayName = 'HoverablePressable';
