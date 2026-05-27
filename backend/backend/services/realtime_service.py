import asyncio
from collections import defaultdict


_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(project_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subscribers[project_id].add(queue)
    return queue


def unsubscribe(project_id: str, queue: asyncio.Queue) -> None:
    queues = _subscribers.get(project_id)
    if not queues:
        return
    queues.discard(queue)
    if not queues:
        _subscribers.pop(project_id, None)


def publish(project_id: str, event: dict) -> None:
    queues = _subscribers.get(project_id)
    if not queues:
        return

    dead_queues = []
    for queue in queues:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            dead_queues.append(queue)

    for queue in dead_queues:
        queues.discard(queue)

    if not queues:
        _subscribers.pop(project_id, None)