import { VNode, normalizeVNode, VNodeChild } from './vnode'
import { ReactiveEffect, UnwrapRef, reactive, immutable } from '@vue/reactivity'
import { EMPTY_OBJ, isFunction, capitalize, invokeHandlers } from '@vue/shared'
import { RenderProxyHandlers } from './componentProxy'
import { ComponentPropsOptions, ExtractPropTypes } from './componentProps'
import { PROPS, DYNAMIC_SLOTS, FULL_PROPS } from './patchFlags'
import { Slots } from './componentSlots'
import { STATEFUL_COMPONENT } from './typeFlags'

export type Data = { [key: string]: unknown }

// public properties exposed on the proxy, which is used as the render context
// in templates (as `this` in the render option)
export type ComponentRenderProxy<P = {}, S = {}, PublicProps = P> = {
  $data: S
  $props: PublicProps
  $attrs: Data
  $refs: Data
  $slots: Data
  $root: ComponentInstance | null
  $parent: ComponentInstance | null
  $emit: (event: string, ...args: unknown[]) => void
} & P &
  S

type SetupFunction<Props, RawBindings> = (
  props: Props,
  ctx: SetupContext
) => RawBindings | (() => VNodeChild)

type RenderFunction<Props = {}, RawBindings = {}> = <
  Bindings extends UnwrapRef<RawBindings>
>(
  this: ComponentRenderProxy<Props, Bindings>,
  ctx: ComponentRenderProxy<Props, Bindings>
) => VNodeChild

interface ComponentOptionsWithoutProps<Props = Data, RawBindings = Data> {
  props?: undefined
  setup?: SetupFunction<Props, RawBindings>
  render?: RenderFunction<Props, RawBindings>
}

interface ComponentOptionsWithArrayProps<
  PropNames extends string = string,
  RawBindings = Data,
  Props = { [key in PropNames]?: unknown }
> {
  props: PropNames[]
  setup?: SetupFunction<Props, RawBindings>
  render?: RenderFunction<Props, RawBindings>
}

interface ComponentOptionsWithProps<
  PropsOptions = ComponentPropsOptions,
  RawBindings = Data,
  Props = ExtractPropTypes<PropsOptions>
> {
  props: PropsOptions
  setup?: SetupFunction<Props, RawBindings>
  render?: RenderFunction<Props, RawBindings>
}

export type ComponentOptions =
  | ComponentOptionsWithProps
  | ComponentOptionsWithoutProps
  | ComponentOptionsWithArrayProps

export interface FunctionalComponent<P = {}> {
  (props: P, ctx: SetupContext): VNodeChild
  props?: ComponentPropsOptions<P>
  displayName?: string
}

type LifecycleHook = Function[] | null

export interface LifecycleHooks {
  bm: LifecycleHook // beforeMount
  m: LifecycleHook // mounted
  bu: LifecycleHook // beforeUpdate
  u: LifecycleHook // updated
  bum: LifecycleHook // beforeUnmount
  um: LifecycleHook // unmounted
  da: LifecycleHook // deactivated
  a: LifecycleHook // activated
  rtg: LifecycleHook // renderTriggered
  rtc: LifecycleHook // renderTracked
  ec: LifecycleHook // errorCaptured
}

interface SetupContext {
  attrs: Data
  slots: Slots
  refs: Data
  parent: ComponentInstance | null
  root: ComponentInstance
  emit: ((event: string, ...args: unknown[]) => void)
}

export type ComponentInstance<P = Data, S = Data> = {
  type: FunctionalComponent | ComponentOptions
  parent: ComponentInstance | null
  root: ComponentInstance
  vnode: VNode
  next: VNode | null
  subTree: VNode
  update: ReactiveEffect
  render: RenderFunction<P, S> | null
  effects: ReactiveEffect[] | null
  provides: Data

  // the rest are only for stateful components
  data: S
  props: P
  renderProxy: ComponentRenderProxy | null
  propsProxy: P | null
  setupContext: SetupContext | null
} & SetupContext &
  LifecycleHooks

// createComponent
// overload 1: direct setup function
// (uses user defined props interface)
export function createComponent<Props>(
  setup: (props: Props, ctx: SetupContext) => (() => unknown)
): (props: Props) => unknown
// overload 2: object format with no props
// (uses user defined props interface)
// return type is for Vetur and TSX support
export function createComponent<Props, RawBindings>(
  options: ComponentOptionsWithoutProps<Props, RawBindings>
): {
  new (): ComponentRenderProxy<Props, UnwrapRef<RawBindings>>
}
// overload 3: object format with array props declaration
// props inferred as { [key in PropNames]?: unknown }
// return type is for Vetur and TSX support
export function createComponent<PropNames extends string, RawBindings>(
  options: ComponentOptionsWithArrayProps<PropNames, RawBindings>
): {
  new (): ComponentRenderProxy<
    { [key in PropNames]?: unknown },
    UnwrapRef<RawBindings>
  >
}
// overload 4: object format with object props declaration
// see `ExtractPropTypes` in ./componentProps.ts
export function createComponent<PropsOptions, RawBindings>(
  options: ComponentOptionsWithProps<PropsOptions, RawBindings>
): {
  // for Vetur and TSX support
  new (): ComponentRenderProxy<
    ExtractPropTypes<PropsOptions>,
    UnwrapRef<RawBindings>,
    ExtractPropTypes<PropsOptions, false>
  >
}
// implementation, close to no-op
export function createComponent(options: any) {
  return isFunction(options) ? { setup: options } : (options as any)
}

export function createComponentInstance(
  type: any,
  parent: ComponentInstance | null
): ComponentInstance {
  const instance = {
    type,
    parent,
    root: null as any, // set later so it can point to itself
    vnode: null as any,
    next: null,
    subTree: null as any,
    update: null as any,
    render: null,
    renderProxy: null,
    propsProxy: null,
    setupContext: null,

    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null,
    effects: null,
    provides: parent ? parent.provides : {},

    // public properties
    data: EMPTY_OBJ,
    props: EMPTY_OBJ,
    attrs: EMPTY_OBJ,
    slots: EMPTY_OBJ,
    refs: EMPTY_OBJ,

    emit: (event: string, ...args: unknown[]) => {
      const props = instance.vnode.props || EMPTY_OBJ
      const handler = props[`on${event}`] || props[`on${capitalize(event)}`]
      if (handler) {
        invokeHandlers(handler, args)
      }
    }
  }

  instance.root = parent ? parent.root : instance
  return instance
}

export let currentInstance: ComponentInstance | null = null

export const getCurrentInstance: () => ComponentInstance | null = () =>
  currentInstance

export function setupStatefulComponent(instance: ComponentInstance) {
  const Component = instance.type as ComponentOptions
  // 1. create render proxy
  instance.renderProxy = new Proxy(instance, RenderProxyHandlers) as any
  // 2. call setup()
  const { setup } = Component
  if (setup) {
    // the props proxy makes the props object passed to setup() reactive
    // so props change can be tracked by watchers
    // it will be updated in resolveProps() on updates before render
    const propsProxy = (instance.propsProxy = setup.length
      ? immutable(instance.props)
      : null)
    const setupContext = (instance.setupContext =
      setup.length > 1 ? createSetupContext(instance) : null)

    currentInstance = instance
    const setupResult = setup.call(null, propsProxy, setupContext)
    currentInstance = null

    if (isFunction(setupResult)) {
      // setup returned an inline render function
      instance.render = setupResult
    } else {
      // setup returned bindings.
      // assuming a render function compiled from template is present.
      instance.data = reactive(setupResult)
      if (__DEV__ && !Component.render) {
        // TODO warn missing render fn
      }
      instance.render = Component.render as RenderFunction
    }
  }
}

const SetupProxyHandlers: { [key: string]: ProxyHandler<any> } = {}
;['attrs', 'slots', 'refs'].forEach((type: string) => {
  SetupProxyHandlers[type] = {
    get: (instance: any, key: string) => (instance[type] as any)[key],
    has: (instance: any, key: string) => key in (instance[type] as any),
    ownKeys: (instance: any) => Object.keys(instance[type] as any),
    set: () => false,
    deleteProperty: () => false
  }
})

function createSetupContext(instance: ComponentInstance): SetupContext {
  const context = {
    // attrs, slots & refs are non-reactive, but they need to always expose
    // the latest values (instance.xxx may get replaced during updates) so we
    // need to expose them through a proxy
    attrs: new Proxy(instance, SetupProxyHandlers.attrs),
    slots: new Proxy(instance, SetupProxyHandlers.slots),
    refs: new Proxy(instance, SetupProxyHandlers.refs),
    emit: instance.emit,
    parent: instance.parent,
    root: instance.root
  } as any
  return __DEV__ ? Object.freeze(context) : context
}

export function renderComponentRoot(instance: ComponentInstance): VNode {
  const {
    type: Component,
    vnode,
    renderProxy,
    setupContext,
    props,
    slots,
    attrs,
    refs,
    emit,
    parent,
    root
  } = instance
  if (vnode.shapeFlag & STATEFUL_COMPONENT) {
    return normalizeVNode(
      (instance.render as RenderFunction).call(renderProxy, props, setupContext)
    )
  } else {
    // functional
    const render = Component as FunctionalComponent
    return normalizeVNode(
      render.length > 1
        ? render(props, {
            attrs,
            slots,
            refs,
            emit,
            parent,
            root
          })
        : render(props, null as any)
    )
  }
}

export function shouldUpdateComponent(
  prevVNode: VNode,
  nextVNode: VNode,
  optimized?: boolean
): boolean {
  const { props: prevProps, children: prevChildren } = prevVNode
  const { props: nextProps, children: nextChildren, patchFlag } = nextVNode
  if (patchFlag) {
    if (patchFlag & DYNAMIC_SLOTS) {
      // slot content that references values that might have changed,
      // e.g. in a v-for
      return true
    }
    if (patchFlag & FULL_PROPS) {
      // presence of this flag indicates props are always non-null
      return hasPropsChanged(prevProps as Data, nextProps as Data)
    } else if (patchFlag & PROPS) {
      const dynamicProps = nextVNode.dynamicProps as string[]
      for (let i = 0; i < dynamicProps.length; i++) {
        const key = dynamicProps[i]
        if ((nextProps as any)[key] !== (prevProps as any)[key]) {
          return true
        }
      }
    }
  } else if (!optimized) {
    // this path is only taken by manually written render functions
    // so presence of any children leads to a forced update
    if (prevChildren != null || nextChildren != null) {
      return true
    }
    if (prevProps === nextProps) {
      return false
    }
    if (prevProps === null) {
      return nextProps !== null
    }
    if (nextProps === null) {
      return prevProps !== null
    }
    return hasPropsChanged(prevProps, nextProps)
  }
  return false
}

function hasPropsChanged(prevProps: Data, nextProps: Data): boolean {
  const nextKeys = Object.keys(nextProps)
  if (nextKeys.length !== Object.keys(prevProps).length) {
    return true
  }
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i]
    if (nextProps[key] !== prevProps[key]) {
      return true
    }
  }
  return false
}
