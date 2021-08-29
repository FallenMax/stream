const isDebugging = false
const isTesting = false

export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || 'assertion failed')
  }
}

export type Callback<T = void> = (arg: T) => void
export type AnyFunction = (...args: any[]) => any | void

export const noop: AnyFunction = () => {}

//-------------- type --------------

export function isStream<T>(o: T | Stream<T> | undefined): o is Stream<T>
export function isStream(o: unknown): o is Stream<unknown> {
  return o instanceof Stream
}

type S<T extends any = any> = Stream<T>
type StreamTuple<T extends any[]> = {
  [K in keyof T]: Stream<T[K]>
}
type MaybeTuple<T extends any[]> = {
  [K in keyof T]: T[K] | Nothing
}

let nextStreamId = 0
let nextSubscriptionId = 0

interface StreamOptions<T, P extends any[] = any[]> {
  displayName: string
  parents: StreamTuple<P>
  /**
   * start consume resource
   * @returns a callback that recycles resources
   */
  onStart?: (stream: Stream<T>) => Callback
  /**
   * this is called when parents has updates, the stream should calculate next value (or skip with Nothing)
   */
  onUpdate?: (...nextParents: MaybeTuple<P>) => T | Nothing
}
export const NOTHING = { is: 'nothing' } as const
export interface Nothing {
  is: 'nothing'
}
export const isNothing = (value: unknown): value is Nothing => value === NOTHING

const DEFAULT_UPDATE = () => NOTHING
const DEFAULT_START = () => noop

/**
 * get topological sorted subgraph
 *
 * @see https://en.wikipedia.org/wiki/Topological_sorting
 */
export const getSubgraphSorted = (root: Stream) => {
  // prepare nodes to visit (BFT)
  const subgraph = new Set<Stream>()
  {
    const queue = [root]
    while (queue.length) {
      const current = queue.pop()!
      if (!subgraph.has(current)) {
        current.children.forEach((child) => {
          if (!subgraph.has(child)) {
            queue.push(child)
          }
        })
        subgraph.add(current)
      }
    }
  }

  // sort
  const sorted: Stream[] = []
  {
    const visited = new Set<Stream>()
    const stack = [root]

    while (stack.length) {
      const node = stack.pop()!

      if (!visited.has(node)) {
        sorted.push(node) // we want to process parent first
        visited.add(node)
      }

      node.children.forEach((child) => {
        if (!visited.has(child)) {
          const parentsVisited = child.parents.every(
            (parent) => !subgraph.has(parent) || visited.has(parent),
          )
          if (parentsVisited) {
            stack.push(child)
          }
        }
      })
    }
  }
  return sorted
}

let updating: string | undefined
const updateSubgraph = <T>(root: Stream<T>, value: T) => {
  if (updating) {
    console.warn(
      `trying to update ${root.displayName} while updating ${updating}`,
    )
  }
  updating = root.displayName
  const subgraph = getSubgraphSorted(root)
  for (const node of subgraph) {
    if (node === root) {
      node.next = value
    } else {
      const inputs = node.parents.map((p) => p.next) as MaybeTuple<any[]>
      if (inputs.every(isNothing)) {
        node.next = NOTHING
      } else {
        node.next = node.onUpdate(...inputs)
      }
    }

    if (!isNothing(node.next)) {
      const next = node.next
      node.value = next
      node.subscribers.forEach((s) => s(next))
    }
  }

  // clean up
  for (const node of subgraph) {
    node.next = NOTHING
  }
  updating = undefined
}

let queue = [] as { node: Stream; value: any }[]
let running = false
const queueUpdate = <T>(root: Stream<T>, value: T) => {
  queue.push({ node: root, value })
  if (running) {
    return
  } else {
    running = true
    while (queue.length) {
      const { node, value } = queue.shift()!
      updateSubgraph(node, value)
    }
    running = false
  }
}

const startIfNeeded = (node: Stream) => {
  if (node.subscribers.size + node.children.size === 1) {
    const stopParents = node.parents.map((p) => addChild(p, node))
    const inputs = node.parents.map((p) => p.value)
    const stopSelf = node.onStart(node)
    node.next = node.onUpdate(...inputs)

    if (!isNothing(node.next)) {
      node.value = node.next
      node.next = NOTHING
    }

    node.stop = () => {
      stopSelf()
      stopParents.forEach((s) => s())
    }
  }
}
const stopIfNeeded = (node: Stream) => {
  if (node.subscribers.size + node.children.size === 0) {
    node.stop()
  }
}

const addChild = (node: Stream, child: Stream) => {
  const id = nextSubscriptionId++
  node.children.set(id, child)
  startIfNeeded(node)
  return () => {
    node.children.delete(id)
    stopIfNeeded(node)
  }
}

const subscribe = <T>(
  node: Stream<T>,
  cb: (value: T) => void,
  emitCurrent: boolean,
) => {
  const id = nextSubscriptionId++
  node.subscribers.set(id, cb)
  startIfNeeded(node)
  if (emitCurrent && !isNothing(node.value)) {
    cb(node.value)
  }
  return () => {
    node.subscribers.delete(id)
    stopIfNeeded(node)
  }
}

export class Stream<T extends any = any> {
  stop: Callback = noop
  onStart: Exclude<StreamOptions<T>['onStart'], undefined> = DEFAULT_START
  onUpdate: Exclude<StreamOptions<T>['onUpdate'], undefined> = DEFAULT_UPDATE

  readonly id = nextStreamId++
  displayName: string
  value: T | Nothing = NOTHING
  get(): T | undefined {
    return isNothing(this.value) ? undefined : this.value
  }

  subscribers = new Map<number, (value: T) => void>()
  next: T | Nothing = NOTHING

  children = new Map<number, Stream>()
  parents: StreamTuple<any[]>

  constructor({
    displayName,
    parents,
    onUpdate = DEFAULT_UPDATE,
    onStart = DEFAULT_START,
  }: StreamOptions<T>) {
    this.displayName = displayName || `s_${this.id}`
    this.parents = parents
    this.onStart = onStart
    this.onUpdate = onUpdate
  }
  set(val: T) {
    queueUpdate(this, val)
    // updateSubgraph(this, val)
  }
  as(name: string, logged = true): Stream<T> {
    return as(name, logged)(this)
  }

  /**
   * subscribe and start the stream
   *
   * - subscribe to stream updates
   * - signals this stream and its ancestors they are being consumed (recursively)
   *   - run required effect if started
   *   - update value
   *
   * @param emitCurrent call subscriber with current value immediately if present
   */
  subscribe(subscriber: (value: T) => void, emitCurrent: boolean): Callback {
    return subscribe(this, subscriber, emitCurrent)
  }
}

export const fromValue = <T>(t: T): S<T> => {
  const s = new Stream<T>({ displayName: `fromValue(${t})`, parents: [] })
  s.set(t)
  return s
}

export const empty = <T>(): S<T> => {
  return new Stream({ displayName: `empty`, parents: [] })
}

const getElementName = (elem: string | Element) => {
  return typeof elem === 'string'
    ? elem
    : // @ts-ignore
    elem === document.documentElement
    ? 'window'
    : // @ts-ignore
      elem.tagName
}
type DebugHandlers = {
  onStart: Callback<EventTarget>
  onStop: Callback<EventTarget>
}
export function fromDomEvent<E extends string, K extends string>(
  elem: E,
  type: K,
  debug?: DebugHandlers,
): S<Event>
export function fromDomEvent<E extends Window, K extends keyof WindowEventMap>(
  elem: E,
  type: K,
  debug?: DebugHandlers,
): S<WindowEventMap[K]>
export function fromDomEvent<
  E extends HTMLElement,
  K extends keyof HTMLElementEventMap,
>(elem: E, type: K, debug?: DebugHandlers): S<HTMLElementEventMap[K]>
export function fromDomEvent<E extends Element | string, K extends string>(
  elem: E,
  type: K,
  debug?: DebugHandlers,
): S<Event> {
  return new Stream<Event>({
    displayName: `event(${getElementName(elem)}:${type})`,
    parents: [],
    onStart(s) {
      const el = typeof elem === 'string' ? document.querySelector(elem) : elem
      assert(el instanceof EventTarget, `elem not found: ${elem}`)
      const emit = (e: any) => s.set(e)
      debug?.onStart(el)
      el.addEventListener(type, emit)
      return () => {
        debug?.onStop(el)
        el.removeEventListener(type, emit)
      }
    },
  })
}

export const interval = (ms: number, emitOnStart: boolean) => {
  let timer: any
  return new Stream<undefined>({
    displayName: `interval(${ms})`,
    parents: [],
    onStart(s) {
      if (emitOnStart) {
        s.set(undefined)
      }
      clearInterval(timer)
      timer = setInterval(() => {
        s.set(undefined)
      }, ms)
      return () => {
        clearInterval(timer)
      }
    },
  })
}

//-------------- pipe --------------

type StreamMapper<A, B> = (a: Stream<A>) => Stream<B>
type M<A = any, B = any> = StreamMapper<A, B>

export function pipe<T>(t$: S<T>, ...mappers: []): S<T>
export function pipe<T, A>(t$: S<T>, ...mappers: [M<T, A>]): S<A>
export function pipe<T, A, B>(t$: S<T>, ...mappers: [M<T, A>, M<A, B>]): S<B>
export function pipe<T, A, B, C>(
  t$: S<T>,
  ...mappers: [M<T, A>, M<A, B>, M<B, C>]
): S<C>
export function pipe<T, A, B, C, D>(
  t$: S<T>,
  ...mappers: [M<T, A>, M<A, B>, M<B, C>, M<C, D>]
): S<D>
export function pipe<T, A, B, C, D, E>(
  t$: S<T>,
  ...mappers: [M<T, A>, M<A, B>, M<B, C>, M<C, D>, M<D, E>]
): S<E>
export function pipe<T, A, B, C, D, E, F>(
  t$: S<T>,
  ...mappers: [M<T, A>, M<A, B>, M<B, C>, M<C, D>, M<D, E>, M<E, F>]
): S<F>
export function pipe(t$: S, ...mappers: M[]): S {
  return mappers.reduce((acc$, map) => map(acc$), t$)
}

//-------------- join --------------

export const combine = <T extends unknown[]>(
  ...streams: StreamTuple<T>
): Stream<T> => {
  return new Stream<T>({
    displayName: `combine(${streams.map((s) => s.displayName).join(',')})`,
    parents: streams,
    onUpdate(...nextParents) {
      const next: any[] = []

      for (let i = 0; i < nextParents.length; i++) {
        let nextP = nextParents[i]
        if (isNothing(nextP)) {
          nextP = streams[i].value
        }
        // parents not started, thus blocking combined stream
        if (isNothing(nextP)) {
          return NOTHING
        }

        next[i] = nextP
      }
      return next as T
    },
  })
}

export const merge = <T extends unknown[]>(
  ...streams: StreamTuple<T>
): Stream<T[number]> => {
  return new Stream({
    displayName: `merge(${streams.map((s) => s.displayName).join(',')})`,
    parents: streams,
    onUpdate: (...nexts) => {
      for (let i = 0; i < nexts.length; i++) {
        let next = nexts[i]
        if (!isNothing(next)) {
          return next
        }
      }
      return NOTHING
    },
  })
}

export const switchLatest = <T>(): M<S<T>, T> => {
  return (outer$) => {
    return new Stream({
      displayName: `switchLatest(${outer$.displayName})`,
      parents: [outer$],
      onStart: (s) => {
        let inner = noop
        const outer = outer$.subscribe((inner$) => {
          inner() // we can dispose previous inner right now as its not used anymore
          inner = inner$.subscribe((value) => s.set(value), true)
        }, true)

        return () => {
          inner()
          outer()
        }
      },
    })
  }
}

//-------------- transform --------------

export const map = <A = any, B = any>(mapper: (a: A) => B): M<A, B> => {
  return (a$) => {
    return new Stream<B>({
      displayName: `map(${a$.displayName})`,
      parents: [a$],
      onUpdate: (value) => {
        if (isNothing(value)) return value
        return mapper(value)
      },
    })
  }
}

export const scan = <T, Acc>(
  reducer: (t: T, acc: Acc) => Acc,
  initial: Acc,
): M<T, Acc> => {
  return (t$) => {
    let acc = initial
    return new Stream<Acc>({
      displayName: `scan(${t$.displayName})`,
      parents: [t$],
      onUpdate: (value) => {
        if (isNothing(value)) {
          return NOTHING
        }
        acc = reducer(value, acc)
        return acc
      },
    })
  }
}

export const unique = () => {
  return <T>(t$: S<T>): S<T> => {
    const s: Stream<T> = new Stream<T>({
      displayName: `unique(${t$.displayName})`,
      parents: [t$],
      onUpdate: (t) => {
        if (isNothing(t)) {
          return NOTHING
        }
        return s.value !== t ? t : NOTHING
      },
    })
    return s
  }
}

export const filter = <In, Out extends In = In>(
  predict: (val: In) => boolean,
): M<In, Out> => {
  return (t$) => {
    return new Stream({
      displayName: `filter(${t$.displayName})`,
      parents: [t$],
      onUpdate: (value) => {
        if (isNothing(value)) return value

        if (predict(value)) {
          return value
        }
        return NOTHING
      },
    })
  }
}

export const debounce = (delay: number) => {
  return <T>(t$: S<T>): S<T> => {
    let timer: any
    const s = new Stream<T>({
      displayName: `debounce(${t$.displayName})`,
      parents: [t$],
      onUpdate: (value) => {
        if (isNothing(value)) {
          return NOTHING
        }
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
        timer = setTimeout(() => {
          s.set(value)
          timer = undefined
        }, delay)
        return NOTHING
      },
      onStart() {
        return () => {
          if (timer) {
            clearTimeout(timer)
            timer = undefined
          }
        }
      },
    })
    return s
  }
}

export const throttle = (delay: number) => {
  return <T>(t$: S<T>): S<T> => {
    let last = -Infinity
    const s = new Stream<T>({
      displayName: `throttle(${t$.displayName})`,
      parents: [t$],
      onUpdate: (value) => {
        if (isNothing(value)) {
          return NOTHING
        }
        const now = Date.now()
        if (now - last > delay) {
          last = now
          return value
        } else {
          return NOTHING
        }
      },
      onStart() {
        return () => {
          last = -Infinity
        }
      },
    })
    return s
  }
}

export const sample = (...samplers: S[]) => {
  return <T>(t$: S<T>): S<T> => {
    return pipe(
      combine(
        t$,
        ...samplers.map(startsWith(undefined)), // to guarantee samplers do not block initial event
      ),
      map(([val]) => val),
    )
  }
}

export const startsWith = <T>(t: T) => {
  return <V>(v$: S<V>): S<V | T> => {
    return merge(fromValue(t), v$)
  }
}

//-------------- cold vs hot --------------

export const start = (...streams: S[]): Callback => {
  const disposers = streams.map((s) => {
    return s.subscribe(noop, true)
  })
  return () => {
    disposers.forEach((d) => d())
  }
}

//-------------- debug --------------

export const log = () => {
  return <T>($t: S<T>): S<T> => {
    return new Stream<T>({
      displayName: `_${$t.displayName}`,
      parents: [$t],
      onUpdate(next) {
        if (!isNothing(next)) {
          // console.info(`$(${$t.id}): ` + $t.displayName, next)
        }
        return next
      },
    })
  }
}

export const as = (name: string, logging = true) => {
  return <T>($t: S<T>): S<T> => {
    $t.displayName = name
    if (logging) {
      return log()($t)
    } else {
      return $t
    }
  }
}
