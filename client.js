window.__ModuleLoader__.load({
  id: 'dsh-image-scope',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NAMESPACE = 'ImageScope';
    const VIEWER_ID = 'dsh-image-scope';
    const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'];
    const BINARY_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'];
    const PIXELATED_FROM = 1.5;

    /* #region pure-math */
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 16;
    const ZOOM_STEP = 1.25;
    const HANDLE_TOLERANCE = 6;

    /** Resize cursors for each selection handle. */
    const HANDLE_CURSORS = {
      nw: 'nwse-resize',
      n: 'ns-resize',
      ne: 'nesw-resize',
      e: 'ew-resize',
      se: 'nwse-resize',
      s: 'ns-resize',
      sw: 'nesw-resize',
      w: 'ew-resize',
    };

    /**
     * Restrict a number to an inclusive interval.
     * @param {number} value - candidate value.
     * @param {number} min - lower bound.
     * @param {number} max - upper bound.
     * @returns {number} the clamped value.
     */
    function clampNumber(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    /** Media types assigned to the image suffixes the builtin preview also renders. */
    const IMAGE_MEDIA_TYPES = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      svg: 'image/svg+xml',
    };

    /**
     * Resolve the media type from a file-resource address.
     * @param {string} address - complete `dsh-resource://file/...` address.
     * @returns {string} the media type, or an empty string when the suffix is unknown.
     */
    function mediaTypeOf(address) {
      if (typeof address !== 'string') return '';
      const bare = address.split(/[?#]/)[0];
      const raw = bare.slice(bare.lastIndexOf('/') + 1);
      let name = raw;
      try {
        name = decodeURIComponent(raw);
      } catch {
        name = raw;
      }
      const dot = name.lastIndexOf('.');
      if (dot < 0) return '';
      return IMAGE_MEDIA_TYPES[name.slice(dot + 1).toLowerCase()] || '';
    }

    /**
     * Order two pixel-space corners into a normalized rectangle.
     * @param {{ x: number, y: number }} start - one corner in image pixels.
     * @param {{ x: number, y: number }} end - the opposite corner in image pixels.
     * @returns {{ left: number, top: number, right: number, bottom: number }} normalized bounds.
     */
    function normalizeRect(start, end) {
      return {
        left: Math.min(start.x, end.x),
        top: Math.min(start.y, end.y),
        right: Math.max(start.x, end.x),
        bottom: Math.max(start.y, end.y),
      };
    }

    /**
     * Measure a normalized rectangle in whole image pixels, corners included.
     * @param {{ left: number, top: number, right: number, bottom: number }} rect - normalized bounds.
     * @returns {{ width: number, height: number }} pixel counts.
     */
    function rectPixelSize(rect) {
      return {
        width: rect.right - rect.left + 1,
        height: rect.bottom - rect.top + 1,
      };
    }

    /**
     * Scale that shows the whole image width without enlarging a smaller image.
     * @param {number} viewportWidth - available content width in CSS pixels.
     * @param {number} intrinsicWidth - image width in image pixels.
     * @param {number} inset - horizontal inset reserved around the stage.
     * @returns {number} the fit scale.
     */
    function fitScale(viewportWidth, intrinsicWidth, inset) {
      if (!(intrinsicWidth > 0) || !(viewportWidth > 0)) return 1;
      return Math.min(1, Math.max(1, viewportWidth - inset) / intrinsicWidth);
    }

    /**
     * Map a pointer position to the image pixel under it.
     * @param {number} clientX - pointer x in viewport coordinates.
     * @param {number} clientY - pointer y in viewport coordinates.
     * @param {{ left: number, top: number, width: number, height: number }} bounds - displayed stage bounds.
     * @param {{ width: number, height: number }} natural - image pixel dimensions.
     * @param {boolean} clampToImage - clamp points outside the image onto its edge.
     * @returns {{ x: number, y: number } | null} the pixel, or null outside the image.
     */
    function pixelPoint(clientX, clientY, bounds, natural, clampToImage) {
      if (!(bounds.width > 0) || !(bounds.height > 0) || !(natural.width > 0) || !(natural.height > 0)) return null;
      const x = Math.floor((clientX - bounds.left) * natural.width / bounds.width);
      const y = Math.floor((clientY - bounds.top) * natural.height / bounds.height);
      if (clampToImage) {
        return {
          x: clampNumber(x, 0, natural.width - 1),
          y: clampNumber(y, 0, natural.height - 1),
        };
      }
      if (x < 0 || y < 0 || x >= natural.width || y >= natural.height) return null;
      return { x, y };
    }

    /**
     * Display positions of the eight selection handles.
     * @param {{ left: number, top: number, right: number, bottom: number }} rect - selection in image pixels.
     * @param {number} scaleX - displayed pixels per image pixel on x.
     * @param {number} scaleY - displayed pixels per image pixel on y.
     * @returns {Record<string, [number, number]>} handle centers in stage pixels.
     */
    function selectionHandles(rect, scaleX, scaleY) {
      const left = rect.left * scaleX;
      const top = rect.top * scaleY;
      const right = (rect.right + 1) * scaleX;
      const bottom = (rect.bottom + 1) * scaleY;
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;
      return {
        nw: [left, top],
        n: [midX, top],
        ne: [right, top],
        w: [left, midY],
        e: [right, midY],
        sw: [left, bottom],
        s: [midX, bottom],
        se: [right, bottom],
      };
    }

    /**
     * Decide whether a pointer grabs a selection handle, its body, or empty canvas.
     * @param {number} clientX - pointer x in viewport coordinates.
     * @param {number} clientY - pointer y in viewport coordinates.
     * @param {{ left: number, top: number, width: number, height: number }} bounds - displayed stage bounds.
     * @param {{ width: number, height: number }} natural - image pixel dimensions.
     * @param {{ left: number, top: number, right: number, bottom: number }} selection - current selection.
     * @returns {{ kind: 'resize', handle: string } | { kind: 'move' } | null} the hit.
     */
    function hitSelection(clientX, clientY, bounds, natural, selection) {
      if (selection === null || !(bounds.width > 0) || !(bounds.height > 0)) return null;
      const x = clientX - bounds.left;
      const y = clientY - bounds.top;
      const scaleX = bounds.width / natural.width;
      const scaleY = bounds.height / natural.height;
      const handles = selectionHandles(selection, scaleX, scaleY);
      const order = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
      for (const handle of order) {
        const center = handles[handle];
        if (Math.abs(x - center[0]) <= HANDLE_TOLERANCE && Math.abs(y - center[1]) <= HANDLE_TOLERANCE) {
          return { kind: 'resize', handle };
        }
      }
      const left = selection.left * scaleX;
      const right = (selection.right + 1) * scaleX;
      const top = selection.top * scaleY;
      const bottom = (selection.bottom + 1) * scaleY;
      if (x >= left && x <= right && y >= top && y <= bottom) return { kind: 'move' };
      return null;
    }

    /**
     * Slide a selection by a pointer delta, keeping the whole box inside the image.
     * @param {{ left: number, top: number, right: number, bottom: number }} rect - selection at gesture start.
     * @param {{ x: number, y: number }} from - pointer pixel at gesture start.
     * @param {{ x: number, y: number }} to - pointer pixel now.
     * @param {{ width: number, height: number }} natural - image pixel dimensions.
     * @returns {{ left: number, top: number, right: number, bottom: number }} the moved, clamped selection.
     */
    function moveSelection(rect, from, to, natural) {
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;
      const left = clampNumber(rect.left + (to.x - from.x), 0, Math.max(0, natural.width - 1 - width));
      const top = clampNumber(rect.top + (to.y - from.y), 0, Math.max(0, natural.height - 1 - height));
      return { left, top, right: left + width, bottom: top + height };
    }

    /**
     * Resize one edge or corner of a selection, snapping each edge to the image bounds.
     * @param {{ left: number, top: number, right: number, bottom: number }} rect - selection at gesture start.
     * @param {string} handle - one of nw, n, ne, e, se, s, sw, w.
     * @param {{ x: number, y: number }} point - pointer pixel now.
     * @param {{ width: number, height: number }} natural - image pixel dimensions.
     * @returns {{ left: number, top: number, right: number, bottom: number }} the resized, clamped selection.
     */
    function resizeSelection(rect, handle, point, natural) {
      let left = rect.left;
      let top = rect.top;
      let right = rect.right;
      let bottom = rect.bottom;
      if (handle.includes('w')) left = clampNumber(point.x, 0, right);
      if (handle.includes('e')) right = clampNumber(point.x, left, natural.width - 1);
      if (handle.includes('n')) top = clampNumber(point.y, 0, bottom);
      if (handle.includes('s')) bottom = clampNumber(point.y, top, natural.height - 1);
      return { left, top, right, bottom };
    }

    /**
     * Next fixed zoom for an incremental control.
     * @param {number} scale - current effective scale.
     * @param {number} direction - 1 to zoom in, -1 to zoom out.
     * @returns {number} the next clamped scale.
     */
    function zoomStep(scale, direction) {
      const next = direction > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP;
      return clampNumber(next, MIN_ZOOM, MAX_ZOOM);
    }

    /**
     * Smooth zoom multiplier for a trackpad pinch or Ctrl/Cmd + wheel gesture.
     * @param {number} deltaY - wheel delta in pixels.
     * @returns {number} a multiplier between 0.8 and 1.25.
     */
    function wheelZoomFactor(deltaY) {
      const factor = Math.exp(-deltaY * 0.0015);
      return clampNumber(factor, 0.8, 1.25);
    }
    /* #endregion pure-math */

    const zh = {
      title: '像素标尺',
      dimensions: '{width} × {height} px',
      pointer: 'X {x} · Y {y}',
      hint: '拖动框选 · 拖动选框调整 · Ctrl/⌘+D 取消',
      start: '起点',
      end: '终点',
      size: '{width} × {height} px',
      fit: '适应',
      actual: '1:1',
      zoomIn: '放大',
      zoomOut: '缩小',
      zoomValue: '{percent}%',
      clear: '清除',
      clearTitle: '取消选框 (Ctrl/⌘+D)',
      loading: '正在加载图片…',
      failed: '图片无法显示',
      unsupported: '无法读取图片数据',
    };

    const en = {
      title: 'Pixel Scope',
      dimensions: '{width} × {height} px',
      pointer: 'X {x} · Y {y}',
      hint: 'Drag to select · Drag the box to adjust · Ctrl/⌘+D clears',
      start: 'Start',
      end: 'End',
      size: '{width} × {height} px',
      fit: 'Fit',
      actual: '1:1',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      zoomValue: '{percent}%',
      clear: 'Clear',
      clearTitle: 'Clear selection (Ctrl/⌘+D)',
      loading: 'Loading image…',
      failed: 'This image could not be displayed',
      unsupported: 'Image data is unavailable',
    };

    /**
     * Built-in fallback for pages booted before the Host injected config.json.
     * config.json is authoritative; the Host injects it as a page global at boot.
     */
    const DEFAULT_CONFIG = {
      font: {
        family: 'var(--dsw-font, sans-serif)',
        mono: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        sizes: { selectionInfo: 11, hud: 11, toolbar: 12, toolbarValue: 11, status: 13 },
        lineHeights: { selectionInfo: 1.45, hud: 1.45, toolbar: 1 },
      },
      canvas: {
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        scrollPadding: 12,
        focusOutline: '2px solid var(--dsw-alias-brand-primary)',
        focusOffset: 2,
      },
      selection: {
        stroke: 'var(--dsw-alias-brand-primary)',
        strokeWidth: 1.5,
        dash: '5 3',
        fill: 'none',
        fillOpacity: 1,
      },
      crosshair: {
        stroke: 'var(--dsw-alias-label-primary)',
        opacity: 0.55,
        strokeWidth: 1,
        dash: '3 3',
      },
      pixel: { fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1 },
      handle: {
        size: 7,
        radius: 1.5,
        fill: 'var(--dsw-alias-bg-overlay)',
        stroke: 'var(--dsw-alias-brand-primary)',
        strokeWidth: 1.25,
      },
      selectionInfo: {
        left: 8,
        bottom: 10,
        maxWidth: 'calc(54% - 12px)',
        gap: 6,
        paddingX: 8,
        paddingY: 1,
        radius: 4,
        borderWidth: 1,
        background: 'var(--dsw-alias-bg-overlay)',
        border: 'var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        valueColor: 'var(--dsw-alias-label-primary)',
        separatorColor: 'var(--dsw-alias-label-secondary)',
        separatorOpacity: 0.6,
      },
      hud: {
        right: 8,
        bottom: 10,
        gap: 6,
        maxWidth: 'calc(100% - 16px)',
        narrowMaxWidth: 'calc(42% - 12px)',
        paddingX: 6,
        paddingY: 1,
        radius: 4,
        borderWidth: 1,
        background: 'var(--dsw-alias-bg-overlay)',
        border: 'var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      toolbar: {
        bottom: 56,
        maxWidth: 'calc(100% - 16px)',
        gap: 2,
        padding: 3,
        radius: 8,
        borderWidth: 1,
        background: 'var(--dsw-alias-bg-overlay)',
        border: 'var(--dsw-alias-border-l1)',
        button: {
          color: 'var(--dsw-alias-label-secondary)',
          paddingX: 8,
          paddingY: 6,
          radius: 6,
          hoverBackground: 'var(--dsw-alias-bg-layer-2)',
          hoverColor: 'var(--dsw-alias-label-primary)',
          pressedColor: 'var(--dsw-alias-brand-primary)',
          pressedBackground: 'var(--dsw-alias-bg-layer-2)',
          focusOutline: '2px solid var(--dsw-alias-brand-primary)',
          focusOffset: 1,
          disabledOpacity: 0.45,
        },
        value: { minWidth: 46, paddingX: 2, color: 'var(--dsw-alias-label-secondary)' },
        separator: { color: 'var(--dsw-alias-border-l1)', height: 16, marginX: 2 },
      },
      status: { color: 'var(--dsw-alias-label-secondary)', padding: 16 },
    };

    function isPlainObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    /** Merge a partial config over the fallback without sharing nested objects. */
    function mergeConfig(base, override) {
      const result = { ...base };
      for (const [key, value] of Object.entries(override)) {
        const current = base[key];
        result[key] = isPlainObject(current) && isPlainObject(value) ? mergeConfig(current, value) : value;
      }
      return result;
    }

    /** Prefer the Host-injected config.json, falling back to the embedded defaults. */
    function resolveConfig() {
      const injected = typeof globalThis === 'object' && globalThis !== null ? globalThis.__DSH_IMAGE_SCOPE_CONFIG__ : undefined;
      return isPlainObject(injected) ? mergeConfig(DEFAULT_CONFIG, injected) : DEFAULT_CONFIG;
    }

    const CONFIG = resolveConfig();
    const STAGE_INSET = CONFIG.canvas.scrollPadding * 2;
    const px = (value) => (typeof value === 'number' ? value + 'px' : value);

    /** Render the stylesheet from the editable config. */
    function buildCss(c) {
      const f = c.font;
      const s = f.sizes;
      const b = c.toolbar.button;
      const v = c.toolbar.value;
      const sep = c.toolbar.separator;
      return `
.imgscope-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:${c.canvas.background};color:${c.canvas.color};font-family:${f.family};white-space:normal;line-height:1.5;box-sizing:border-box}
.imgscope-scroll{flex:1;min-height:0;overflow:auto;padding:${px(c.canvas.scrollPadding)};box-sizing:border-box;scrollbar-gutter:stable}
.imgscope-stage{position:relative;margin:0 auto;user-select:none;-webkit-user-select:none;touch-action:none;cursor:crosshair;line-height:0;outline:none}
.imgscope-stage:focus-visible{outline:${c.canvas.focusOutline};outline-offset:${px(c.canvas.focusOffset)}}
.imgscope-image{display:block;max-width:none;max-height:none;user-select:none;-webkit-user-drag:none;background:transparent}
.imgscope-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.imgscope-selection{position:absolute;left:${px(c.selectionInfo.left)};bottom:${px(c.selectionInfo.bottom)};z-index:3;pointer-events:none;display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:${px(c.selectionInfo.gap)};max-width:${c.selectionInfo.maxWidth};padding:${px(c.selectionInfo.paddingY)} ${px(c.selectionInfo.paddingX)};border-radius:${px(c.selectionInfo.radius)};background:${c.selectionInfo.background};border:${px(c.selectionInfo.borderWidth)} solid ${c.selectionInfo.border};color:${c.selectionInfo.color};font-family:${f.mono};font-size:${px(s.selectionInfo)};line-height:${f.lineHeights.selectionInfo};font-variant-numeric:tabular-nums;box-sizing:border-box}
.imgscope-selection-part{white-space:nowrap}
.imgscope-selection-value{color:${c.selectionInfo.valueColor};font-weight:500}
.imgscope-selection-sep{color:${c.selectionInfo.separatorColor};opacity:${c.selectionInfo.separatorOpacity}}
.imgscope-hud{position:absolute;right:${px(c.hud.right)};bottom:${px(c.hud.bottom)};z-index:3;pointer-events:none;display:flex;flex-direction:row;gap:${px(c.hud.gap)};align-items:center;justify-content:flex-end;max-width:${c.hud.maxWidth}}
.imgscope-hud-narrow{max-width:${c.hud.narrowMaxWidth}}
.imgscope-hudrow{display:inline-block;max-width:100%;font-family:${f.mono};font-size:${px(s.hud)};line-height:${f.lineHeights.hud};font-variant-numeric:tabular-nums;padding:${px(c.hud.paddingY)} ${px(c.hud.paddingX)};border-radius:${px(c.hud.radius)};background:${c.hud.background};border:${px(c.hud.borderWidth)} solid ${c.hud.border};color:${c.hud.color};box-sizing:border-box;white-space:nowrap}
.imgscope-hudrow-hint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.imgscope-hudrow-size{flex:none}
.imgscope-toolbar{position:absolute;left:50%;bottom:${px(c.toolbar.bottom)};transform:translateX(-50%);z-index:3;display:flex;align-items:center;gap:${px(c.toolbar.gap)};padding:${px(c.toolbar.padding)};border-radius:${px(c.toolbar.radius)};background:${c.toolbar.background};border:${px(c.toolbar.borderWidth)} solid ${c.toolbar.border};box-sizing:border-box;max-width:${c.toolbar.maxWidth}}
.imgscope-tool{appearance:none;border:0;background:transparent;color:${b.color};font-family:${f.family};font-size:${px(s.toolbar)};line-height:${f.lineHeights.toolbar};font-weight:500;padding:${px(b.paddingY)} ${px(b.paddingX)};border-radius:${px(b.radius)};cursor:pointer;font-variant-numeric:tabular-nums}
.imgscope-tool:hover:not(:disabled){background:${b.hoverBackground};color:${b.hoverColor}}
.imgscope-tool:disabled{opacity:${b.disabledOpacity};cursor:default}
.imgscope-tool[aria-pressed="true"]{color:${b.pressedColor};background:${b.pressedBackground}}
.imgscope-tool:focus-visible{outline:${b.focusOutline};outline-offset:${px(b.focusOffset)}}
.imgscope-value{min-width:${px(v.minWidth)};text-align:center;color:${v.color};font-family:${f.mono};font-size:${px(s.toolbarValue)};line-height:${f.lineHeights.toolbar};font-variant-numeric:tabular-nums;padding:0 ${px(v.paddingX)}}
.imgscope-sep{width:1px;height:${px(sep.height)};background:${sep.color};margin:0 ${px(sep.marginX)};flex:none}
.imgscope-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;padding:${px(c.status.padding)};color:${c.status.color};font-size:${px(s.status)};text-align:center;pointer-events:none}
`;
    }

    const CSS = buildCss(CONFIG);

    /**
     * Sidebar image viewer with a pixel readout, one adjustable rectangle, and anchored zoom.
     * @param {object} props - document body props plus the slot's locale translator.
     * @returns {object} the rendered viewer.
     */
    function ImageScopeBody(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const content = props.content;
      const data = content !== undefined && content.kind === 'bytes' ? content.data : undefined;
      const mediaType = React.useMemo(() => mediaTypeOf(props.resourceAddress), [props.resourceAddress]);

      const [source, setSource] = React.useState(null);
      const [natural, setNatural] = React.useState(null);
      const [failure, setFailure] = React.useState(null);
      const [containerWidth, setContainerWidth] = React.useState(0);
      const [view, setView] = React.useState({ mode: 'fit', zoom: 1 });
      const [hover, setHover] = React.useState(null);
      const [hoverHit, setHoverHit] = React.useState(null);
      const [selection, setSelection] = React.useState(null);
      const [draft, setDraft] = React.useState(null);
      const [gesture, setGesture] = React.useState(null);

      const scrollRef = React.useRef(null);
      const stageRef = React.useRef(null);
      const gestureRef = React.useRef(null);
      const hoverRef = React.useRef(null);
      const hoverHitRef = React.useRef(null);
      const anchorRef = React.useRef(null);
      const stateRef = React.useRef({ scale: 1, natural: null });

      const unsupported = content === undefined || content.kind !== 'bytes';

      /** Point the owner's scroll-sync callback at our inner scrollport. */
      const attachScroll = React.useCallback((node) => {
        scrollRef.current = node;
        if (typeof props.scrollportRef === 'function') props.scrollportRef(node);
      }, [props.scrollportRef]);

      React.useEffect(() => {
        if (data === undefined) {
          setSource(null);
          setNatural(null);
          return undefined;
        }
        let url;
        try {
          url = URL.createObjectURL(mediaType === '' ? new Blob([data]) : new Blob([data], { type: mediaType }));
        } catch {
          setSource(null);
          setNatural(null);
          setFailure('failed');
          return undefined;
        }
        setFailure(null);
        setNatural(null);
        setSource(url);
        return () => {
          URL.revokeObjectURL(url);
        };
      }, [data, mediaType]);

      React.useEffect(() => {
        if (source === null) return undefined;
        let cancelled = false;
        const probe = new Image();
        probe.onload = () => {
          if (cancelled) return;
          if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
            setNatural({ width: probe.naturalWidth, height: probe.naturalHeight });
          } else {
            setFailure('failed');
          }
        };
        probe.onerror = () => {
          if (cancelled) return;
          setFailure('failed');
        };
        probe.src = source;
        return () => {
          cancelled = true;
          probe.onload = null;
          probe.onerror = null;
        };
      }, [source]);

      React.useEffect(() => {
        const node = scrollRef.current;
        if (node === null) return undefined;
        const measure = () => setContainerWidth(node.clientWidth);
        measure();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(node);
          return () => observer.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, []);

      /** A new file must not inherit the previous selection or hover state. */
      React.useEffect(() => {
        const active = gestureRef.current;
        gestureRef.current = null;
        setGesture(null);
        if (active !== null) releasePointer(active.pointerId);
        setDraft(null);
        setSelection(null);
        hoverRef.current = null;
        hoverHitRef.current = null;
        setHover(null);
        setHoverHit(null);
      }, [props.resourceAddress]);

      const scale = natural === null ? 1 : view.mode === 'fit' ? fitScale(containerWidth, natural.width, STAGE_INSET) : clampNumber(view.zoom, MIN_ZOOM, MAX_ZOOM);
      const displayWidth = natural === null ? 0 : natural.width * scale;
      const displayHeight = natural === null ? 0 : natural.height * scale;
      const ready = natural !== null && source !== null && !unsupported && failure === null;
      const scaleX = natural === null ? 1 : displayWidth / natural.width;
      const scaleY = natural === null ? 1 : displayHeight / natural.height;

      React.useLayoutEffect(() => {
        stateRef.current = { scale, natural };
      });

      /** Keep the anchored image point under the pointer after a zoom change. */
      React.useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (anchor === null) return;
        anchorRef.current = null;
        const stage = stageRef.current;
        const scroll = scrollRef.current;
        if (stage === null || scroll === null || natural === null) return;
        const bounds = stage.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return;
        scroll.scrollLeft += bounds.left + anchor.x * (bounds.width / natural.width) - anchor.clientX;
        scroll.scrollTop += bounds.top + anchor.y * (bounds.height / natural.height) - anchor.clientY;
      }, [view, natural, containerWidth]);

      React.useEffect(() => {
        const node = scrollRef.current;
        if (node === null) return undefined;
        const onWheel = (event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          const current = stateRef.current;
          if (current.natural === null) return;
          event.preventDefault();
          const next = clampNumber(current.scale * wheelZoomFactor(event.deltaY), MIN_ZOOM, MAX_ZOOM);
          if (Math.abs(next - current.scale) < 0.0005) return;
          const stage = stageRef.current;
          if (stage !== null) {
            const bounds = stage.getBoundingClientRect();
            if (bounds.width > 0 && bounds.height > 0) {
              anchorRef.current = {
                x: (event.clientX - bounds.left) * current.natural.width / bounds.width,
                y: (event.clientY - bounds.top) * current.natural.height / bounds.height,
                clientX: event.clientX,
                clientY: event.clientY,
              };
            }
          }
          current.scale = next;
          setView({ mode: 'fixed', zoom: next });
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
      }, []);

      /**
       * Gestures track the pointer on the document, so a drag past the image edge
       * keeps updating and snaps to the boundary instead of stopping at the stage.
       */
      React.useEffect(() => {
        const onPointerMove = (event) => {
          const active = gestureRef.current;
          if (active === null || active.pointerId !== event.pointerId) return;
          const natural = stateRef.current.natural;
          const stage = stageRef.current;
          if (natural === null || stage === null) return;
          const point = pixelPoint(event.clientX, event.clientY, stage.getBoundingClientRect(), natural, true);
          if (point === null) return;
          showHover(point);
          if (active.type === 'draft') {
            active.current = point;
            if (Math.abs(event.clientX - active.startClientX) + Math.abs(event.clientY - active.startClientY) > 2) active.moved = true;
            setDraft({ start: active.start, current: point });
          } else if (active.type === 'move') {
            setSelection(moveSelection(active.startRect, active.startPoint, point, natural));
          } else {
            setSelection(resizeSelection(active.startRect, active.handle, point, natural));
          }
        };
        const onPointerUp = (event) => {
          const active = gestureRef.current;
          if (active === null || active.pointerId !== event.pointerId) return;
          finishGesture(event, active);
        };
        const onPointerCancel = (event) => {
          const active = gestureRef.current;
          if (active === null || active.pointerId !== event.pointerId) return;
          cancelGesture();
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerCancel);
        };
      }, []);

      const pointAt = (clientX, clientY, clampToImage) => {
        const stage = stageRef.current;
        if (stage === null || natural === null) return null;
        return pixelPoint(clientX, clientY, stage.getBoundingClientRect(), natural, clampToImage);
      };

      function showHover(point) {
        const previous = hoverRef.current;
        if (point === null) {
          if (previous === null) return;
          hoverRef.current = null;
          setHover(null);
          return;
        }
        if (previous !== null && previous.x === point.x && previous.y === point.y) return;
        hoverRef.current = point;
        setHover(point);
      }

      function showHoverHit(hit) {
        const previous = hoverHitRef.current;
        const previousKey = previous === null ? '' : previous.kind + ':' + (previous.handle ?? '');
        const nextKey = hit === null ? '' : hit.kind + ':' + (hit.handle ?? '');
        if (previousKey === nextKey) return;
        hoverHitRef.current = hit;
        setHoverHit(hit);
      }

      function focusStage() {
        const stage = stageRef.current;
        if (stage === null) return;
        try {
          stage.focus({ preventScroll: true });
        } catch {
          stage.focus();
        }
      }

      /** Release capture without letting a detached stage throw. */
      function releasePointer(pointerId) {
        const stage = stageRef.current;
        if (stage === null) return;
        try {
          stage.releasePointerCapture(pointerId);
        } catch {
          /* The pointer may already be released by the browser. */
        }
      }

      function cancelGesture() {
        const active = gestureRef.current;
        gestureRef.current = null;
        setGesture(null);
        if (active === null) return;
        releasePointer(active.pointerId);
        showHoverHit(null);
        if (active.type === 'draft') setDraft(null);
        else setSelection(active.startRect);
      }

      /** Commit (or finalize) a tracked gesture using its release coordinates. */
      function finishGesture(event, active) {
        gestureRef.current = null;
        setGesture(null);
        releasePointer(active.pointerId);
        const natural = stateRef.current.natural;
        const stage = stageRef.current;
        const point = natural === null || stage === null ? null : pixelPoint(event.clientX, event.clientY, stage.getBoundingClientRect(), natural, true);
        if (point !== null) {
          if (active.type === 'draft') {
            active.current = point;
            if (Math.abs(event.clientX - active.startClientX) + Math.abs(event.clientY - active.startClientY) > 2) active.moved = true;
          } else if (active.type === 'move') {
            setSelection(moveSelection(active.startRect, active.startPoint, point, natural));
          } else {
            setSelection(resizeSelection(active.startRect, active.handle, point, natural));
          }
        }
        showHoverHit(null);
        if (active.type !== 'draft') return;
        setDraft(null);
        if (active.moved) setSelection(normalizeRect(active.start, active.current));
      }

      const clearSelection = () => {
        const active = gestureRef.current;
        gestureRef.current = null;
        setGesture(null);
        if (active !== null) releasePointer(active.pointerId);
        setDraft(null);
        setSelection(null);
        showHoverHit(null);
      };

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          if (gestureRef.current !== null) {
            event.preventDefault();
            cancelGesture();
          }
          return;
        }
        const isD = event.key === 'd' || event.key === 'D' || event.code === 'KeyD';
        if (!isD || !(event.ctrlKey || event.metaKey)) return;
        // Swallow the browser bookmark shortcut while the viewer owns focus.
        event.preventDefault();
        event.stopPropagation();
        if (selection !== null || draft !== null || gestureRef.current !== null) clearSelection();
      };

      const handlePointerDown = (event) => {
        if (event.button !== 0) return;
        const stage = stageRef.current;
        if (stage === null || natural === null) return;
        focusStage();
        const bounds = stage.getBoundingClientRect();
        const hit = selection === null || draft !== null ? null : hitSelection(event.clientX, event.clientY, bounds, natural, selection);
        if (hit !== null) {
          const point = pixelPoint(event.clientX, event.clientY, bounds, natural, true);
          if (point === null) return;
          event.preventDefault();
          try {
            stage.setPointerCapture(event.pointerId);
          } catch {
            /* Document-level tracking still receives moves when capture is unavailable. */
          }
          gestureRef.current = hit.kind === 'move'
            ? { type: 'move', pointerId: event.pointerId, startRect: selection, startPoint: point }
            : { type: 'resize', pointerId: event.pointerId, startRect: selection, handle: hit.handle };
          setGesture({ kind: hit.kind, handle: hit.handle ?? null });
          return;
        }
        const point = pixelPoint(event.clientX, event.clientY, bounds, natural, false);
        if (point === null) return;
        event.preventDefault();
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {
          /* Document-level tracking still receives moves when capture is unavailable. */
        }
        gestureRef.current = {
          type: 'draft',
          pointerId: event.pointerId,
          start: point,
          current: point,
          startClientX: event.clientX,
          startClientY: event.clientY,
          moved: false,
        };
        setGesture({ kind: 'draft', handle: null });
        setDraft({ start: point, current: point });
      };

      const handlePointerMove = (event) => {
        if (gestureRef.current !== null) return;
        const stage = stageRef.current;
        if (stage === null || natural === null) return;
        const bounds = stage.getBoundingClientRect();
        const point = pixelPoint(event.clientX, event.clientY, bounds, natural, false);
        showHover(point);
        showHoverHit(selection === null || draft !== null ? null : hitSelection(event.clientX, event.clientY, bounds, natural, selection));
      };

      const handlePointerLeave = () => {
        if (gestureRef.current !== null) return;
        showHover(null);
        showHoverHit(null);
      };

      const clearAnchor = () => {
        anchorRef.current = null;
      };

      const setFixedZoom = (next) => {
        setView({ mode: 'fixed', zoom: clampNumber(next, MIN_ZOOM, MAX_ZOOM) });
      };

      /** Anchor a toolbar zoom on the middle of the visible viewport. */
      const zoomFromToolbar = (next) => {
        const target = clampNumber(next, MIN_ZOOM, MAX_ZOOM);
        if (Math.abs(target - scale) < 0.0005) return;
        const stage = stageRef.current;
        const scroll = scrollRef.current;
        if (stage !== null && scroll !== null && natural !== null) {
          const bounds = stage.getBoundingClientRect();
          const viewport = scroll.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0) {
            const centerX = viewport.left + viewport.width / 2;
            const centerY = viewport.top + viewport.height / 2;
            anchorRef.current = {
              x: (centerX - bounds.left) * natural.width / bounds.width,
              y: (centerY - bounds.top) * natural.height / bounds.height,
              clientX: centerX,
              clientY: centerY,
            };
          }
        }
        setFixedZoom(target);
      };

      const fitWidth = () => {
        clearAnchor();
        setView({ mode: 'fit', zoom: 1 });
      };

      const actualSize = () => {
        zoomFromToolbar(1);
      };

      const activeRect = draft !== null ? normalizeRect(draft.start, draft.current) : selection;
      const showHandles = selection !== null && draft === null;
      const cursor = gesture !== null
        ? gesture.kind === 'move' ? 'move' : gesture.kind === 'resize' ? HANDLE_CURSORS[gesture.handle] : 'crosshair'
        : hoverHit !== null
          ? hoverHit.kind === 'move' ? 'move' : HANDLE_CURSORS[hoverHit.handle]
          : 'crosshair';

      const overlay = ready ? h('svg', {
        className: 'imgscope-overlay',
        viewBox: '0 0 ' + displayWidth + ' ' + displayHeight,
        'aria-hidden': 'true',
      },
        hover === null ? null : [
          h('line', {
            key: 'cross-x',
            x1: 0,
            x2: displayWidth,
            y1: (hover.y + 0.5) * scaleY,
            y2: (hover.y + 0.5) * scaleY,
            stroke: CONFIG.crosshair.stroke,
            strokeOpacity: CONFIG.crosshair.opacity,
            strokeWidth: CONFIG.crosshair.strokeWidth,
            strokeDasharray: CONFIG.crosshair.dash,
          }),
          h('line', {
            key: 'cross-y',
            x1: (hover.x + 0.5) * scaleX,
            x2: (hover.x + 0.5) * scaleX,
            y1: 0,
            y2: displayHeight,
            stroke: CONFIG.crosshair.stroke,
            strokeOpacity: CONFIG.crosshair.opacity,
            strokeWidth: CONFIG.crosshair.strokeWidth,
            strokeDasharray: CONFIG.crosshair.dash,
          }),
          h('rect', {
            key: 'cross-pixel',
            x: hover.x * scaleX,
            y: hover.y * scaleY,
            width: Math.max(scaleX, 1),
            height: Math.max(scaleY, 1),
            fill: CONFIG.pixel.fill,
            stroke: CONFIG.pixel.stroke,
            strokeWidth: CONFIG.pixel.strokeWidth,
          }),
        ],
        activeRect === null ? null : h('rect', {
          key: 'selection',
          x: activeRect.left * scaleX,
          y: activeRect.top * scaleY,
          width: rectPixelSize(activeRect).width * scaleX,
          height: rectPixelSize(activeRect).height * scaleY,
          fill: CONFIG.selection.fill,
          fillOpacity: CONFIG.selection.fillOpacity,
          stroke: CONFIG.selection.stroke,
          strokeWidth: CONFIG.selection.strokeWidth,
          strokeDasharray: CONFIG.selection.dash,
        }),
        showHandles ? Object.entries(selectionHandles(selection, scaleX, scaleY)).map(([handle, center]) => h('rect', {
          key: 'handle-' + handle,
          x: center[0] - CONFIG.handle.size / 2,
          y: center[1] - CONFIG.handle.size / 2,
          width: CONFIG.handle.size,
          height: CONFIG.handle.size,
          rx: CONFIG.handle.radius,
          fill: CONFIG.handle.fill,
          stroke: CONFIG.handle.stroke,
          strokeWidth: CONFIG.handle.strokeWidth,
        })) : null
      ) : null;

      const stage = ready ? h('div', {
        className: 'imgscope-stage',
        ref: stageRef,
        tabIndex: 0,
        'data-image-scope': 'stage',
        'aria-label': t('title'),
        style: { width: displayWidth + 'px', height: displayHeight + 'px', cursor },
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerLeave: handlePointerLeave,
      },
        h('img', {
          className: 'imgscope-image',
          src: source,
          alt: '',
          draggable: false,
          style: {
            width: displayWidth + 'px',
            height: displayHeight + 'px',
            imageRendering: scale >= PIXELATED_FROM ? 'pixelated' : 'auto',
          },
          onError: () => setFailure('failed'),
        }),
        overlay
      ) : null;

      const statusText = unsupported ? t('unsupported') : failure === 'failed' ? t('failed') : ready ? null : t('loading');

      const selectionInfo = ready && activeRect !== null ? (() => {
        const size = rectPixelSize(activeRect);
        return h('div', { className: 'imgscope-selection', 'aria-hidden': 'true' },
          h('span', { key: 'start', className: 'imgscope-selection-part' },
            t('start') + ' ',
            h('span', { key: 'start-value', className: 'imgscope-selection-value' }, activeRect.left + ',' + activeRect.top)),
          h('span', { key: 'sep-a', className: 'imgscope-selection-sep' }, '·'),
          h('span', { key: 'end', className: 'imgscope-selection-part' },
            t('end') + ' ',
            h('span', { key: 'end-value', className: 'imgscope-selection-value' }, activeRect.right + ',' + activeRect.bottom)),
          h('span', { key: 'sep-b', className: 'imgscope-selection-sep' }, '·'),
          h('span', { key: 'size', className: 'imgscope-selection-part imgscope-selection-value' }, t('size', { width: size.width, height: size.height }))
        );
      })() : null;

      const hud = ready ? h('div', { className: 'imgscope-hud' + (selectionInfo === null ? '' : ' imgscope-hud-narrow'), 'aria-hidden': 'true' },
        h('span', { className: 'imgscope-hudrow imgscope-hudrow-hint' }, hover === null ? t('hint') : t('pointer', { x: hover.x, y: hover.y })),
        h('span', { className: 'imgscope-hudrow imgscope-hudrow-size' }, t('dimensions', { width: natural.width, height: natural.height }))
      ) : null;

      const percent = Math.round(scale * 100);
      const toolbar = ready ? h('div', { className: 'imgscope-toolbar', role: 'toolbar', 'aria-label': t('title') },
        h('button', {
          type: 'button',
          className: 'imgscope-tool',
          'aria-pressed': view.mode === 'fit',
          title: t('fit'),
          onClick: fitWidth,
        }, t('fit')),
        h('button', {
          type: 'button',
          className: 'imgscope-tool',
          'aria-pressed': view.mode === 'fixed' && Math.abs(view.zoom - 1) < 0.0005,
          title: t('actual'),
          onClick: actualSize,
        }, t('actual')),
        h('span', { className: 'imgscope-sep', 'aria-hidden': 'true' }),
        h('button', {
          type: 'button',
          className: 'imgscope-tool',
          'aria-label': t('zoomOut'),
          title: t('zoomOut'),
          onClick: () => zoomFromToolbar(zoomStep(scale, -1)),
        }, '−'),
        h('span', { className: 'imgscope-value', 'aria-hidden': 'true' }, t('zoomValue', { percent })),
        h('button', {
          type: 'button',
          className: 'imgscope-tool',
          'aria-label': t('zoomIn'),
          title: t('zoomIn'),
          onClick: () => zoomFromToolbar(zoomStep(scale, 1)),
        }, '+'),
        h('span', { className: 'imgscope-sep', 'aria-hidden': 'true' }),
        h('button', {
          type: 'button',
          className: 'imgscope-tool',
          disabled: selection === null && draft === null,
          'aria-label': t('clearTitle'),
          title: t('clearTitle'),
          onClick: clearSelection,
        }, t('clear'))
      ) : null;

      return h('div', { className: 'imgscope-root', 'data-image-scope': 'root', onKeyDown: handleKeyDown },
        h('style', { key: 'imgscope-style' }, CSS),
        h('div', { className: 'imgscope-scroll', ref: attachScroll, 'data-image-scope': 'scroll' }, stage),
        statusText === null ? null : h('p', {
          className: 'imgscope-status',
          role: failure === 'failed' ? 'alert' : undefined,
        }, statusText),
        hud,
        selectionInfo,
        toolbar
      );
    }

    return {
      inject: ['documentPreviews', 'slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NAMESPACE);
        ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'image-scope: dictionaries');
        ctx.effect(() => ctx.documentPreviews.register({
          id: VIEWER_ID,
          extensions: IMAGE_EXTENSIONS,
          binaryExtensions: BINARY_IMAGE_EXTENSIONS,
          priority: 'extension',
          title: () => t('title'),
          loading: 'bytes-complete',
          wrap: false,
        }), 'image-scope: viewer');
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
          name: 'sidebar.right.tab.document',
          key: VIEWER_ID,
          locale: NAMESPACE,
        }, ImageScopeBody)), 'image-scope: body');
      },
    };
  },
});
