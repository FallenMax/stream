import {
  as,
  Callback,
  combine,
  debounce,
  empty,
  fromDomEvent,
  fromValue,
  getSubgraphSorted,
  interval,
  map,
  merge,
  NOTHING,
  pipe,
  sample,
  startsWith,
  Stream,
  switchLatest,
  throttle,
  unique,
} from './index'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('new Stream()', () => {
  const mockOnStart = jest.fn()
  const mockOnStop = jest.fn()

  let s = new Stream<number>({
    displayName: 'abc',
    parents: [],
    onStart: (s2) => {
      mockOnStart(s2)
      return mockOnStop
    },
  })
  expect(s.displayName).toEqual('abc')
  s = s.as('bcd', false)
  expect(s.displayName).toEqual('bcd')
  expect(s.value).toEqual(NOTHING)

  const mockListener1 = jest.fn()
  const unsubscribe1 = s.subscribe(mockListener1, true)
  expect(mockListener1.mock.calls).toEqual([])

  s.set(1)
  const mockListener2 = jest.fn()
  const unsubscribe2 = s.subscribe(mockListener2, true)
  expect(mockListener2.mock.calls).toEqual([[1]])
  const mockListener3 = jest.fn()
  const unsubscribe3 = s.subscribe(mockListener3, false)
  expect(mockListener3.mock.calls).toEqual([])

  s.set(2)
  expect(mockListener1.mock.calls).toEqual([[1], [2]])
  expect(mockListener2.mock.calls).toEqual([[1], [2]])
  expect(mockOnStart.mock.calls.length).toEqual(1)
  expect(s.value).toEqual(2)

  unsubscribe1()
  s.set(3)
  expect(mockListener1.mock.calls).toEqual([[1], [2]])
  expect(mockListener2.mock.calls).toEqual([[1], [2], [3]])
  expect(mockOnStop.mock.calls).toEqual([])

  unsubscribe2()
  s.set(4)
  expect(mockListener1.mock.calls).toEqual([[1], [2]])
  expect(mockListener2.mock.calls).toEqual([[1], [2], [3]])

  unsubscribe3()
  expect(mockOnStop.mock.calls).toEqual([[]])
})

test('fromValue()', () => {
  const s = fromValue(1)

  expect(s.value).toEqual(1)

  const mockListener = jest.fn()
  s.subscribe(mockListener, true)
  expect(mockListener.mock.calls).toEqual([[1]])
})

test('fromDomEvent()', () => {
  const div = document.createElement('div')
  div.id = 'test'
  div.style.height = '100px'
  div.style.background = 'blue'

  document.body.appendChild(div)

  const DEBUG_eventHandlerCount = new Map<EventTarget, number>()
  const click$ = fromDomEvent(div, 'click', {
    onStart(el) {
      DEBUG_eventHandlerCount.set(
        el,
        (DEBUG_eventHandlerCount.get(el) || 0) + 1,
      )
    },
    onStop(el) {
      DEBUG_eventHandlerCount.set(
        el,
        (DEBUG_eventHandlerCount.get(el) || 0) - 1,
      )
    },
  })
  const handlerCount = () => DEBUG_eventHandlerCount.get(div) ?? 0
  expect(handlerCount()).toEqual(0)

  const mockListener1 = jest.fn()
  const mockListener2 = jest.fn()

  const unsubscribe1 = click$.subscribe(mockListener1, true)
  expect(handlerCount()).toEqual(1)

  const unsubscribe2 = click$.subscribe(mockListener2, true)
  expect(handlerCount()).toEqual(1)

  div.click()
  expect(mockListener1.mock.calls.length).toEqual(1)
  expect(mockListener2.mock.calls.length).toEqual(1)

  unsubscribe1()
  expect(handlerCount()).toEqual(1)

  unsubscribe2()
  expect(handlerCount()).toEqual(0)

  div.click()
  expect(mockListener1.mock.calls.length).toEqual(1)
  expect(mockListener2.mock.calls.length).toEqual(1)
})

test('pipe()', () => {
  {
    const s = pipe(
      fromValue(1),
      map((a) => a + 1),
      map((a) => String(a) + '!'),
    )

    const mockListener = jest.fn()
    s.subscribe(mockListener, true)
    expect(mockListener.mock.calls.pop()[0]).toEqual('2!')
  }
  {
    const s = pipe(fromValue(1))

    const mockListener = jest.fn()
    s.subscribe(mockListener, true)
    expect(mockListener.mock.calls.pop()[0]).toEqual(1)
  }
})

test('map()', () => {
  const s = fromValue(1)
  const s2 = map<number, number>((x) => x * 2)(s)

  const mockListener = jest.fn()
  s2.subscribe(mockListener, true)
  s.set(2)
  expect(mockListener.mock.calls).toEqual([[2], [4]])
})

test('combine()', () => {
  const s1 = fromValue(1)
  const s2 = fromValue(2)
  const s3 = empty<number>()
  const mockRun = jest.fn()
  const mockOnStop = jest.fn()
  const s4 = new Stream({
    displayName: 's4',
    parents: [],
    onStart: () => {
      mockRun()
      return mockOnStop
    },
  })
  s4.set(0)

  const sum = combine(s1, s2, s3, s4)
  expect(mockRun.mock.calls.length).toEqual(0)

  const mockListener = jest.fn()
  const unsub = sum.subscribe(mockListener, true)
  expect(mockListener.mock.calls.length).toEqual(0)

  s1.set(3)
  expect(mockListener.mock.calls.length).toEqual(0)

  s3.set(1)
  expect(mockListener.mock.calls.pop()[0]).toEqual([3, 2, 1, 0])

  unsub()
  expect(mockOnStop.mock.calls.length).toEqual(1)
})

test('merge()', () => {
  {
    const a = fromValue(1)
    const b = empty<number>()
    const c = merge(a, b)

    const mockListener = jest.fn()
    c.subscribe(mockListener, true)
    expect(mockListener.mock.calls).toEqual([[1]])

    a.set(2)
    b.set(3)
    expect(mockListener.mock.calls).toEqual([[1], [2], [3]])
  }
  {
    const a = fromValue(1)
    const b = pipe(
      a,
      map((x) => x + 1),
    )
    const c = merge(a, a, b, b)

    const mockListener = jest.fn()
    c.subscribe(mockListener, true)
    a.set(2)
    expect(mockListener.mock.calls.length).toEqual(2)
  }
})

test('unique()', () => {
  const s1$ = fromValue(1)

  const unique$ = unique()(s1$)
  const mockListener = jest.fn()

  const unsub = unique$.subscribe(mockListener, true)

  s1$.set(2)
  s1$.set(2)
  s1$.set(3)
  s1$.set(3)
  expect(mockListener.mock.calls).toEqual([[1], [2], [3]])
})

test('startsWith()', () => {
  const s1$ = empty<number>()

  const startsWith$ = startsWith(0)(s1$)
  const mockListener = jest.fn()

  const unsub = startsWith$.subscribe(mockListener, true)

  s1$.set(1)
  expect(mockListener.mock.calls).toEqual([[0], [1]])
})

test('interval()', async () => {
  const interval$ = interval(50, true)

  return Promise.race([
    wait(170).then((e) => {
      throw 'timeout'
    }),
    new Promise<void>((resolve) => {
      let count = 0
      const stop = interval$.subscribe(() => {
        count++
        if (count === 4) {
          stop()
          resolve()
        }
      }, true)
    }),
  ])
})

test('throttle()', async () => {
  const s = empty<number>()
  const debounced = throttle(50)(s)

  const mockListener = jest.fn()
  debounced.subscribe(mockListener, true)

  s.set(0)
  await wait(20)
  s.set(1)

  await wait(60)

  s.set(2)
  await wait(20)
  s.set(3)

  await wait(60)

  expect(mockListener.mock.calls).toEqual([[0], [2]])
})

test('debounce()', async () => {
  const s = empty<number>()
  const debounced = debounce(50)(s)

  const mockListener = jest.fn()
  debounced.subscribe(mockListener, true)

  s.set(0)
  await wait(20)
  s.set(1)

  await wait(60)

  s.set(2)
  await wait(20)
  s.set(3)

  await wait(60)

  expect(mockListener.mock.calls).toEqual([[1], [3]])
})

test('sample()', async () => {
  const inc$ = fromValue(1)
  const interval$ = interval(50, false)
  const sampled$ = pipe(inc$, sample(interval$))

  const mockListener = jest.fn()
  sampled$.subscribe(mockListener, true)

  await wait(190)

  expect(mockListener.mock.calls).toEqual([[1], [1], [1], [1]])
})

test('switchLatest()', async (): Promise<any> => {
  let value = 0
  const s = pipe(
    interval(60, true),
    map((_) => {
      value++
      return pipe(
        interval(30, true),
        map((_) => value),
      )
    }),
    switchLatest(),
  )

  return Promise.race([
    wait(1000).then(() => {
      throw 'timeout'
    }),
    new Promise<void>((resolve, reject) => {
      let last = -Infinity
      const unsub = s.subscribe((val) => {
        if (val < last) {
          reject('should be ordered')
          unsub()
        }
        if (val >= 5) {
          resolve()
          unsub()
        }
      }, true)
    }),
  ])
})

const testGraphTraversal = (
  createGraph: (
    declare: (name: string, ...parents: Stream<any>[]) => Stream,
  ) => {
    root: Stream
    nodes: Record<string, Stream>
  },
) => {
  let id = 0
  const checks: Callback[] = []
  const { root, nodes } = createGraph((displayName, ...parents) => {
    const s = new Stream({ parents, displayName })
    parents.forEach((p) => p.children.set(id++, s))

    checks.push(() => {
      parents.forEach((p) => {
        assertSequence(p.displayName, displayName)
      })
    })
    return s
  })
  const subgraph = getSubgraphSorted(root).map((s) => s.displayName)
  const assertSequence = (a: string, b: string) => {
    const bi = subgraph.indexOf(b)
    const ai = subgraph.indexOf(a)
    if (ai !== -1 && bi !== -1) {
      expect(ai < bi).toBe(true)
    }
  }

  expect(subgraph.slice().sort()).toEqual(Object.keys(nodes).slice().sort())
  checks.forEach((c) => c())
}
test('graph traversal', () => {
  testGraphTraversal((D) => {
    const a1 = D('a1')
    const a2 = D('a2')

    const b1 = D('b1', a1, a2)
    const b2 = D('b2', a1)
    const b3 = D('b3', a1)

    const c1 = D('c1', b1, b2)
    const c2 = D('c2', b2, b3)

    const d1 = D('d1', c1, b3)

    const e1 = D('e1', d1, c2)

    const nodes = {
      a1,
      b1,
      b2,
      b3,
      c1,
      c2,
      d1,
      e1,
    }
    return {
      root: a1,
      nodes,
    }
  })
})

test('graph traversal: more complex', () => {
  testGraphTraversal((S) => {
    const a1 = S('a1')

    const b1 = S('b1', a1)
    const b2 = S('b2', a1)

    const c1 = S('c1', b1)
    const c2 = S('c2', b1, b2)
    const c3 = S('c3', b2)

    const d1 = S('d1', c1, c2)
    const d2 = S('d2', c2, c3)

    const e1 = S('e1', d1, d2)

    const nodes = {
      a1,
      b1,
      b2,
      c1,
      c2,
      c3,
      d1,
      d2,
      e1,
    }

    return {
      root: a1,
      nodes,
    }
  })
})

test('graph traversal: with duplicated parents', () => {
  testGraphTraversal((S) => {
    const a1 = S('a1')
    const b1 = S('b1', a1)
    const c1 = S('c1', b1, b1, a1, a1)
    const nodes = {
      a1,
      b1,
      c1,
    }
    return {
      root: a1,
      nodes,
    }
  })
})

test('atomic update: graph traversal', () => {
  const addOne = (x: number) => x + 1
  const addXY = ([x, y]: [number, number]): number => x + y
  const a1 = empty<number>().as('a1')

  const b1 = map(addOne)(a1).as('b1')
  const b2 = map(addOne)(a1).as('b2')
  const b3 = map(addOne)(a1).as('b3')

  const c1 = pipe(combine(b1, b2), map(addXY)).as('c1')
  const c2 = pipe(combine(b2, b3), map(addXY)).as('c2')

  const d1 = pipe(combine(c1, b3), map(addXY)).as('d1')

  const e1 = pipe(combine(d1, c2), map(addXY)).as('e1')

  const streams = {
    a1,
    b1,
    b2,
    b3,
    c1,
    c2,
    d1,
    e1,
  }
  const mocked = jest.fn()

  Object.keys(streams).forEach((key) => {
    // @ts-ignore
    const s = streams[key] as Stream<number>
    s.subscribe(() => mocked(key), true)
  })

  a1.set(1)
  const visited = mocked.mock.calls.map((p) => p[0])
  expect(visited.slice().sort()).toEqual(Object.keys(streams).slice().sort())
})

test('atomic update: basic', () => {
  const top$ = empty<number>()

  const combined$ = combine(top$, top$)

  const mockListener = jest.fn()

  combined$.subscribe(mockListener, true)

  top$.set(0)
  top$.set(1)
  top$.set(2)
  expect(mockListener.mock.calls).toEqual([[[0, 0]], [[1, 1]], [[2, 2]]])
})

test('atomic update: on subscribe', () => {
  const s1 = fromValue(1).as('s1')
  const s2 = fromValue(2).as('s2')
  const combined = combine(unique()(s1), unique()(s2)).as('combine')
  const mocked = jest.fn()
  combined.subscribe(mocked, true)

  expect(mocked.mock.calls).toEqual([[[1, 2]]])
  s1.set(1)
  expect(mocked.mock.calls).toEqual([[[1, 2]]])
})

test('atomic update: all operators', () => {
  const common$ = empty<number>()

  const s1$ = pipe(
    common$,
    map((a) => a + 1),
    map((a) => String(a)),
    as('s1'),
  )
  const s2$ = pipe(
    common$,
    map((a) => a * 2),
    map((a) => String(a)),
    as('s2'),
  )

  const sum$ = pipe(
    combine(s1$, s2$),
    map(([s1, s2]) => s1 + '/' + s2),
    as('sum'),
  )

  const mockListener = jest.fn()

  sum$.subscribe(mockListener, true)

  common$.set(0)
  common$.set(1)
  common$.set(2)
  expect(mockListener.mock.calls).toEqual([['1/0'], ['2/2'], ['3/4']])
})

test('atomic update: update while updating', () => {
  const a$ = empty<number>().as('a')
  const b$ = pipe(
    a$,
    map((a) => a + 1),
  ).as('b')
  const c$ = pipe(
    b$,
    map((b) => b + 1),
  ).as('c')

  const mockListener = jest.fn()
  a$.subscribe((v) => mockListener('a', v), true)
  b$.subscribe((v) => mockListener('b', v), true)
  c$.subscribe((v) => mockListener('c', v), true)

  let cTriggered = false
  c$.subscribe((v) => {
    if (!cTriggered) {
      cTriggered = true
      a$.set(10)
    }
  }, true)
  a$.set(1)

  expect(mockListener.mock.calls).toEqual([
    ['a', 1],
    ['b', 2],
    ['c', 3],
    ['a', 10],
    ['b', 11],
    ['c', 12],
  ])
})
