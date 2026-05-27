from copy import deepcopy
from collections import deque

from services.exceptions import ValidationError

WORKFLOW_CATEGORIES = {"todo", "in_progress", "done"}

DEFAULT_WORKFLOW = {
    "states": [
        {
            "id": "backlog",
            "name": "Backlog",
            "category": "todo",
            "color": "#64748B",
            "position": 0,
            "is_initial": True,
        },
        {
            "id": "selected_for_development",
            "name": "Selected for Development",
            "category": "todo",
            "color": "#0EA5E9",
            "position": 1,
            "is_initial": False,
        },
        {
            "id": "in_progress",
            "name": "In Progress",
            "category": "in_progress",
            "color": "#F59E0B",
            "position": 2,
            "is_initial": False,
        },
        {
            "id": "in_review",
            "name": "In Review",
            "category": "in_progress",
            "color": "#A855F7",
            "position": 3,
            "is_initial": False,
        },
        {
            "id": "done",
            "name": "Done",
            "category": "done",
            "color": "#22C55E",
            "position": 4,
            "is_initial": False,
        },
    ],
    "transitions": [
        {
            "id": "backlog_to_selected",
            "name": "Select for Development",
            "from_state_ids": ["backlog"],
            "to_state_id": "selected_for_development",
            "conditions": [],
            "post_functions": [],
            "position": 0,
        },
        {
            "id": "selected_to_backlog",
            "name": "Move to Backlog",
            "from_state_ids": ["selected_for_development"],
            "to_state_id": "backlog",
            "conditions": [],
            "post_functions": [],
            "position": 1,
        },
        {
            "id": "selected_to_in_progress",
            "name": "Start Progress",
            "from_state_ids": ["selected_for_development"],
            "to_state_id": "in_progress",
            "conditions": [],
            "post_functions": [],
            "position": 2,
        },
        {
            "id": "in_progress_to_selected",
            "name": "Move Back to Selected",
            "from_state_ids": ["in_progress"],
            "to_state_id": "selected_for_development",
            "conditions": [],
            "post_functions": [],
            "position": 3,
        },
        {
            "id": "in_progress_to_review",
            "name": "Send to Review",
            "from_state_ids": ["in_progress"],
            "to_state_id": "in_review",
            "conditions": [],
            "post_functions": [],
            "position": 4,
        },
        {
            "id": "review_to_in_progress",
            "name": "Request Changes",
            "from_state_ids": ["in_review"],
            "to_state_id": "in_progress",
            "conditions": [],
            "post_functions": [],
            "position": 5,
        },
        {
            "id": "review_to_done",
            "name": "Complete",
            "from_state_ids": ["in_review"],
            "to_state_id": "done",
            "conditions": [],
            "post_functions": [{"type": "set_field", "field": "resolved_at", "value": "now"}],
            "position": 6,
        },
        {
            "id": "done_to_review",
            "name": "Reopen",
            "from_state_ids": ["done"],
            "to_state_id": "in_review",
            "conditions": [],
            "post_functions": [],
            "position": 7,
        },
    ],
}


def get_default_workflow() -> dict:
    return deepcopy(DEFAULT_WORKFLOW)


def get_initial_state_id(workflow: dict) -> str:
    for state in workflow["states"]:
        if state.get("is_initial"):
            return state["id"]
    raise ValidationError("Workflow must define exactly one initial state")


def get_state_by_id(workflow: dict, state_id: str) -> dict | None:
    for state in workflow["states"]:
        if state["id"] == state_id:
            return state
    return None


def _normalize_state_key(value: str) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def resolve_workflow_state_id(workflow: dict, requested_state: str) -> str | None:
    normalized = _normalize_state_key(requested_state)
    if not normalized:
        return None

    direct_match = get_state_by_id(workflow, requested_state)
    if direct_match:
        return direct_match["id"]

    for state in workflow["states"]:
        if _normalize_state_key(state.get("id", "")) == normalized:
            return state["id"]
        if _normalize_state_key(state.get("name", "")) == normalized:
            return state["id"]

    aliases = {
        "todo": ["selected_for_development", "to_do", "todo", "backlog"],
        "in_progress": ["in_progress", "doing", "development"],
        "in_review": ["in_review", "review", "qa"],
        "done": ["done", "completed", "closed"],
    }

    # Allow callers to send either canonical keys (todo/in_progress/...) or alias values.
    canonical_from_alias = {}
    for canonical, alias_values in aliases.items():
        for alias_value in alias_values:
            canonical_from_alias[_normalize_state_key(alias_value)] = canonical
    normalized = canonical_from_alias.get(normalized, normalized)

    if normalized in aliases:
        candidates = aliases[normalized]
        normalized_candidates = {_normalize_state_key(candidate) for candidate in candidates}
        for state in workflow["states"]:
            state_id_key = _normalize_state_key(state.get("id", ""))
            state_name_key = _normalize_state_key(state.get("name", ""))
            if state_id_key in normalized_candidates or state_name_key in normalized_candidates:
                return state["id"]

        if normalized == "todo":
            todo_states = [state for state in workflow["states"] if state.get("category") == "todo"]
            if todo_states:
                # Prefer a non-backlog todo state for active board columns.
                non_backlog = [state for state in todo_states if _normalize_state_key(state.get("id", "")) != "backlog"]
                return (non_backlog[0] if non_backlog else todo_states[0])["id"]

        if normalized == "in_review":
            for state in workflow["states"]:
                if state.get("category") == "in_progress" and "review" in _normalize_state_key(state.get("name", "")):
                    return state["id"]

        if normalized == "in_progress":
            for state in workflow["states"]:
                if state.get("category") == "in_progress" and "review" not in _normalize_state_key(state.get("name", "")):
                    return state["id"]

        if normalized == "done":
            for state in workflow["states"]:
                if state.get("category") == "done":
                    return state["id"]

    return None


def validate_workflow_config(workflow: dict) -> dict:
    if not isinstance(workflow, dict):
        raise ValidationError("Workflow must be an object")

    states = workflow.get("states")
    transitions = workflow.get("transitions")

    if not isinstance(states, list) or len(states) == 0:
        raise ValidationError("Workflow states must be a non-empty array")
    if not isinstance(transitions, list):
        raise ValidationError("Workflow transitions must be an array")

    state_ids: set[str] = set()
    state_names: set[str] = set()
    initial_count = 0

    for state in states:
        if not isinstance(state, dict):
            raise ValidationError("Each workflow state must be an object")

        state_id = str(state.get("id", "")).strip()
        name = str(state.get("name", "")).strip()
        category = str(state.get("category", "")).strip()

        if not state_id:
            raise ValidationError("Workflow state id is required")
        if state_id in state_ids:
            raise ValidationError(f"Duplicate workflow state id: {state_id}")
        if not name:
            raise ValidationError(f"Workflow state name is required for {state_id}")
        normalized_name = name.strip().lower()
        if normalized_name in state_names:
            raise ValidationError(f"Duplicate workflow state name: {name}")
        if category not in WORKFLOW_CATEGORIES:
            raise ValidationError(f"Invalid workflow state category for {state_id}")

        state_ids.add(state_id)
        state_names.add(normalized_name)
        if bool(state.get("is_initial")):
            initial_count += 1

    if initial_count != 1:
        raise ValidationError("Workflow must define exactly one initial state")

    transition_ids: set[str] = set()
    for transition in transitions:
        if not isinstance(transition, dict):
            raise ValidationError("Each workflow transition must be an object")

        transition_id = str(transition.get("id", "")).strip()
        name = str(transition.get("name", "")).strip()
        to_state_id = str(transition.get("to_state_id", "")).strip()
        from_state_ids = transition.get("from_state_ids")
        conditions = transition.get("conditions", [])
        post_functions = transition.get("post_functions", [])

        if not transition_id:
            raise ValidationError("Workflow transition id is required")
        if transition_id in transition_ids:
            raise ValidationError(f"Duplicate workflow transition id: {transition_id}")
        if not name:
            raise ValidationError(f"Workflow transition name is required for {transition_id}")
        if to_state_id not in state_ids:
            raise ValidationError(f"Workflow transition references unknown to_state_id: {to_state_id}")
        if not isinstance(from_state_ids, list) or len(from_state_ids) == 0:
            raise ValidationError(f"Workflow transition from_state_ids must be a non-empty array: {transition_id}")
        if not isinstance(conditions, list):
            raise ValidationError(f"Workflow transition conditions must be an array: {transition_id}")
        if not isinstance(post_functions, list):
            raise ValidationError(f"Workflow transition post_functions must be an array: {transition_id}")

        for from_state_id in from_state_ids:
            if from_state_id != "*" and from_state_id not in state_ids:
                raise ValidationError(
                    f"Workflow transition references unknown from_state_id: {from_state_id}"
                )
        transition_ids.add(transition_id)

    return workflow


def find_valid_transition(workflow: dict, current_state_id: str, target_state_id: str) -> dict | None:
    for transition in workflow["transitions"]:
        if transition["to_state_id"] != target_state_id:
            continue
        from_states = transition.get("from_state_ids", [])
        if "*" in from_states or current_state_id in from_states:
            return transition
    return None


def find_transition_path(
    workflow: dict,
    current_state_id: str,
    target_state_id: str,
    max_steps: int = 6,
) -> list[dict]:
    if current_state_id == target_state_id:
        return []

    queue = deque([(current_state_id, [])])
    visited = {current_state_id}

    while queue:
        state_id, path = queue.popleft()
        if len(path) >= max_steps:
            continue

        for transition in workflow.get("transitions", []):
            from_states = transition.get("from_state_ids", [])
            if "*" not in from_states and state_id not in from_states:
                continue

            next_state = transition.get("to_state_id")
            if not next_state or next_state in visited:
                continue

            next_path = [*path, transition]
            if next_state == target_state_id:
                return next_path

            visited.add(next_state)
            queue.append((next_state, next_path))

    return []