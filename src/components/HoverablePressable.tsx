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
          
          // Skip applying hover effect to the specific interactive elements that shouldn't visibly get it
          // OR if disabled, etc. We could do this unconditionally and let React Native manage it.
          // To be safe, we only apply hover effects if it's "interactive"
          return [
            baseStyle,
            hovered && { opacity: 0.8 },
            pressed && { opacity: 0.6 }
          ];
        }}
      />
    );
  }
);
HoverablePressable.displayName = 'HoverablePressable';
