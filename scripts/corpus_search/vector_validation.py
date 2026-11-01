"""Share full-pool verification across nested, drained search stages."""
from contextlib import contextmanager
from contextvars import ContextVar

_active = ContextVar('verified_vector_read_scopes', default=())


@contextmanager
def vector_read_scope(pool):
    # Parallel dense stages inherit the context; their owner drains them before
    # leaving this scope. Per-shard read checks remain inside VectorPool.
    if any(owner is pool for owner in _active.get()):
        yield
        return
    pool.assert_unchanged()
    token = _active.set((*_active.get(), pool))
    try:
        yield
    finally:
        _active.reset(token)
        # No successful result can leave the enclosing operation if any of its
        # pinned files changed, including a shard read by an earlier stage.
        pool.assert_unchanged()
