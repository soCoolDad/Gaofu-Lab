import React, { useState } from 'react'

interface ResizeHandleProps {
  orientation: 'horizontal' | 'vertical'
  onResizeStart: (e: React.MouseEvent) => void
  title?: string
}

export default function ResizeHandle({ orientation, onResizeStart, title }: ResizeHandleProps) {
  const [showHandle, setShowHandle] = useState(false)

  if (orientation === 'horizontal') {
    return (
      <div
        onMouseDown={onResizeStart}
        onMouseEnter={() => setShowHandle(true)}
        onMouseLeave={() => setShowHandle(false)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 12,
          cursor: 'row-resize',
          zIndex: 10,
        }}
        title={title || '拖动调整高度'}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 40,
            height: 4,
            background: showHandle ? '#CBD5E1' : 'transparent',
            borderRadius: 2,
            transition: 'all 0.2s ease',
          }}
        />
      </div>
    )
  }

  return (
    <div
      onMouseDown={onResizeStart}
      onMouseEnter={() => setShowHandle(true)}
      onMouseLeave={() => setShowHandle(false)}
      style={{
        width: 8,
        cursor: 'col-resize',
        background: 'transparent',
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        zIndex: 10,
      }}
      title={title || '拖动调整宽度'}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 3,
          height: 36,
          background: showHandle ? '#CBD5E1' : 'transparent',
          borderRadius: 2,
          transition: 'all 0.2s ease',
        }}
      />
    </div>
  )
}
