# Another FRP library (WIP)

_Quoted from [StreetStrider/fluh](https://github.com/StreetStrider/fluh):_

> When thinking of reactive stuff there're multiple spaces of decisions in which you have to make a choice.
>
> - Is it push or pull?
> - Is it unicast or multicast?
> - Is it always live or depends on subscribers' presense?
> - Does stream have value at any time?
> - Is it sync or async?
> - How errors should be handled?
> - Does stream end?
> - Is data graph static or dynamic?
>
> Choosing some decisions will lead to a specific FRP system.
> Watch [this speech](https://www.youtube.com/watch?v=Agu6jipKfYw) about this decision space.

This library is:

- A push-strategy FRP implementation
- Stream only become _active_ when there are subscribers, and stops when there are none
- Streams are shared/multicast by default, and contains single (current) value
- "no update" is expressed with special value `NOTHING` during update, so `null` or `undefined` can be freely used, you can also detect or return `NOTHING` when building your stream
- Data graph is static by default
- Update is atomic like [flyd](https://github.com/paldepind/flyd#atomic-updates), avoiding intermediate states
- Sync by default

There are still some unfinished parts, namely:

- Figure out how to handle update-during-another-update
- Figure out how to handle subscribe/unsubscribe-during-update
- More essential operators
- Benchmark and performance optimizations
