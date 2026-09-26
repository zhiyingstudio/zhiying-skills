/**
 * ink-captcha · React 封装
 *
 * 只是把原生组件套一层 —— 没有任何额外逻辑，所以体积几乎为零。
 * 如果你不用 React，直接忽略这个文件，用 ink-captcha.js 即可。
 *
 * @example
 *   import { PointsCaptcha } from "ink-captcha/react";
 *
 *   const [token, setToken] = useState(null);
 *   <PointsCaptcha onVerified={setToken} endpoint="/api/captcha/points" />
 *   <button disabled={!token}>注册</button>
 */

import { useEffect, useRef } from "react";

/** 从包内相对路径加载原生组件（打包器会处理） */
import { mount } from "./ink-captcha.js";

export function PointsCaptcha({
  onVerified,
  onStateChange,
  endpoint,
  verifyEndpoint,
  theme,
  maxScale,
  texts,
  headers,
  className,
  style,
}) {
  const boxRef = useRef(null);
  const instRef = useRef(null);
  // 用 ref 保存回调，避免父组件每次 render 都重建实例
  const cbRef = useRef({ onVerified, onStateChange });
  cbRef.current = { onVerified, onStateChange };

  useEffect(() => {
    if (!boxRef.current) return;
    const inst = mount(boxRef.current, {
      endpoint,
      verifyEndpoint,
      theme,
      maxScale,
      texts,
      headers,
      onVerified: (t) => cbRef.current.onVerified && cbRef.current.onVerified(t),
      onStateChange: (s) => cbRef.current.onStateChange && cbRef.current.onStateChange(s),
    });
    instRef.current = inst;
    return () => {
      inst.destroy();
      instRef.current = null;
    };
    // 只在挂载/卸载时建实例；配置项变化通过下方 ref 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 暴露实例方法给父组件（通过 ref 或 window 上的调试钩子）
  useEffect(() => {
    if (boxRef.current) boxRef.current.__inkCaptchaInstance = instRef.current;
  });

  return <div ref={boxRef} className={className} style={style} />;
}

export default PointsCaptcha;
