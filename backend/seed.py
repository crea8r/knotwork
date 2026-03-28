#!/usr/bin/env python3
"""
Seed script: create a default dev workspace + demo graph if none exists.
Upserts VITE_DEV_WORKSPACE_ID into the root .env so Vite and pydantic-settings
both pick it up from a single file.

Usage: .venv/bin/python seed.py
"""
import asyncio
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent

DEMO_GRAPH = {
    "nodes": [
        {
            "id": "agent-1",
            "type": "llm_agent",
            "name": "Analyse",
            "config": {
                "instructions": "You are a helpful assistant. Summarise the input clearly and concisely."
            },
        },
        {
            "id": "checkpoint-1",
            "type": "human_checkpoint",
            "name": "Review",
            "config": {
                "prompt_to_operator": "Please review the summary above and approve or edit."
            },
        },
    ],
    "edges": [
        {"id": "e1", "source": "agent-1", "target": "checkpoint-1", "type": "direct"}
    ],
    "entry_point": "agent-1",
}

DEMO_PROJECTS: list[dict[str, Any]] = [
    {
        "title": "Fan Discovery Sprint",
        "description": "Turn early creator interest into a qualified waiting list and repeatable outreach motion.",
        "status": "open",
        "objectives": [
            {
                "code": "S1",
                "title": "Find the first 20 fan interviews",
                "description": "Identify and schedule interviews with likely early adopters.",
                "status": "in_progress",
                "progress_percent": 40,
                "status_summary": "Eight interviews are booked. We need stronger inbound from existing followers.",
                "key_results": ["20 interview slots booked", "8 interviews completed"],
            },
            {
                "code": "S1.1",
                "title": "Waiting list of 20 people",
                "description": "Capture warm interest from conversations and content.",
                "status": "in_progress",
                "progress_percent": 55,
                "status_summary": "The form is converting, but referral copy is still weak.",
                "key_results": ["20 qualified signups", "5 referrals from existing fans"],
                "parent_code": "S1",
            },
            {
                "code": "S2",
                "title": "Test three outreach angles",
                "description": "Compare creator-led, community-led, and referral-led outreach.",
                "status": "open",
                "progress_percent": 20,
                "status_summary": "Creator-led is performing best so far.",
                "key_results": ["3 outreach sequences shipped", "1 winning angle selected"],
            },
            {
                "code": "S3",
                "title": "Publish fan insight summary",
                "description": "Synthesize what fans value most and where they drop off.",
                "status": "blocked",
                "progress_percent": 10,
                "status_summary": "Waiting for the final interview notes to land in knowledge.",
                "key_results": ["Summary shared with team", "Top 5 themes captured"],
            },
        ],
        "channels": [
            {
                "name": "Creator outreach notes",
                "messages": [
                    ("You", "Shared the shortlist of creators who replied this week."),
                    ("Iris", "Two of them can probably bring five strong referrals each if we make the ask concrete."),
                ],
            },
            {
                "name": "Waitlist copy review",
                "messages": [
                    ("You", "Current signup copy is too product-heavy. We should lead with the fan benefit."),
                    ("Agent Zero", "Suggested a tighter headline and a shorter referral prompt for the thank-you screen."),
                ],
            },
            {
                "name": "Interview scheduling",
                "messages": [
                    ("Theo", "Calendly link is live. We still need two weekend slots."),
                    ("You", "I can cover Saturday morning if that helps close the last few people."),
                ],
            },
        ],
        "project_messages": [
            ("You", "This week is about getting enough signal from real fans, not polishing the funnel."),
            ("Agent Zero", "Current momentum is best in creator referrals. Recommend shifting more effort there."),
        ],
    },
    {
        "title": "Launch Narrative",
        "description": "Shape the story, launch materials, and supporting assets for the public beta.",
        "status": "open",
        "objectives": [
            {
                "code": "L1",
                "title": "Lock the launch promise",
                "description": "Turn scattered messaging into one sharp promise.",
                "status": "in_progress",
                "progress_percent": 65,
                "status_summary": "The draft is close, but the proof point is still abstract.",
                "key_results": ["Final promise approved", "One proof point attached"],
            },
            {
                "code": "L2",
                "title": "Draft launch page",
                "description": "Translate the promise into a page structure.",
                "status": "open",
                "progress_percent": 35,
                "status_summary": "Hero and social proof are drafted; pricing section is unresolved.",
                "key_results": ["Hero shipped", "Social proof block ready", "CTA wording approved"],
            },
            {
                "code": "L3",
                "title": "Produce launch assets",
                "description": "Screens, social snippets, and short demos ready for distribution.",
                "status": "open",
                "progress_percent": 25,
                "status_summary": "We have concept frames but not the final visual direction.",
                "key_results": ["6 social cards", "1 short demo", "1 press image set"],
            },
        ],
        "channels": [
            {
                "name": "Messaging critiques",
                "messages": [
                    ("You", "The current headline is descriptive but not memorable."),
                    ("Nora", "Agree. It explains the product but not the feeling of progress."),
                ],
            },
            {
                "name": "Launch asset requests",
                "messages": [
                    ("Mei", "Need one clean screenshot set without placeholder runs."),
                    ("You", "I will capture those after the sidebar pass lands."),
                ],
            },
            {
                "name": "Beta announcement thread",
                "messages": [
                    ("Agent Zero", "Drafted a tighter announcement with a stronger call to action."),
                    ("You", "Keep the tone concrete. No startup-adjacent fluff."),
                ],
            },
        ],
        "project_messages": [
            ("You", "Launch narrative is lagging the product. We need the message to catch up this week."),
            ("Agent Zero", "Recommendation: decide promise first, then let the page and assets inherit it."),
        ],
    },
    {
        "title": "Concierge Pilot Ops",
        "description": "Support early pilot teams and turn ad hoc requests into repeatable operating patterns.",
        "status": "open",
        "objectives": [
            {
                "code": "P1",
                "title": "Onboard three pilot teams",
                "description": "Get each pilot to first value with a clean kickoff sequence.",
                "status": "in_progress",
                "progress_percent": 50,
                "status_summary": "Two pilots are active. The third is blocked on access approvals.",
                "key_results": ["3 pilot kickoffs", "3 shared success criteria docs"],
            },
            {
                "code": "P2",
                "title": "Create pilot escalation playbook",
                "description": "Turn recurring support issues into a standard response path.",
                "status": "open",
                "progress_percent": 30,
                "status_summary": "Patterns are visible, but the operator handoff is still loose.",
                "key_results": ["Top 10 issues documented", "Escalation tree agreed"],
            },
            {
                "code": "P3",
                "title": "Measure weekly pilot health",
                "description": "Create a lightweight health score for each active team.",
                "status": "open",
                "progress_percent": 15,
                "status_summary": "Signals identified. The score formula still needs simplification.",
                "key_results": ["Weekly health review ritual", "Health score visible per pilot"],
            },
            {
                "code": "P4",
                "title": "Document one strong case study",
                "description": "Capture a concrete pilot win with before/after evidence.",
                "status": "blocked",
                "progress_percent": 5,
                "status_summary": "Waiting for usage metrics from the most active pilot.",
                "key_results": ["Case study outline", "Metrics confirmed by customer"],
            },
        ],
        "channels": [
            {
                "name": "Pilot triage",
                "messages": [
                    ("You", "Three requests came in overnight. Two are setup issues and one is a workflow gap."),
                    ("Ravi", "I can take the setup issues if we document the fixes in knowledge afterward."),
                ],
            },
            {
                "name": "Onboarding prep",
                "messages": [
                    ("You", "Need a tighter kickoff checklist before the next pilot starts."),
                    ("Agent Zero", "I grouped the last two kickoff notes into a proposed checklist draft."),
                ],
            },
            {
                "name": "Case study evidence",
                "messages": [
                    ("Theo", "We have quotes, but still no hard numbers."),
                    ("You", "Let’s not publish a story until we can prove the outcome."),
                ],
            },
        ],
        "project_messages": [
            ("You", "Pilot work is drifting into heroics. We need clearer repeatable ops."),
            ("Agent Zero", "Most friction comes from kickoff ambiguity. Standardizing that should reduce escalations quickly."),
        ],
    },
    {
        "title": "Knowledge Garden",
        "description": "Clean up scattered docs, tighten handbook structure, and make project knowledge easier to reuse.",
        "status": "open",
        "objectives": [
            {
                "code": "K1",
                "title": "Map the current knowledge sprawl",
                "description": "Identify duplicated docs, dead ends, and missing ownership.",
                "status": "in_progress",
                "progress_percent": 60,
                "status_summary": "The map is clear enough to start merging weak pages.",
                "key_results": ["Sprawl map completed", "Owners assigned to top 10 pages"],
            },
            {
                "code": "K2",
                "title": "Rewrite handbook navigation",
                "description": "Make the handbook easier to scan and maintain.",
                "status": "open",
                "progress_percent": 25,
                "status_summary": "The target taxonomy is drafted but not yet socialized.",
                "key_results": ["New top-level categories", "Archive plan for dead pages"],
            },
            {
                "code": "K3",
                "title": "Connect project assets to reusable knowledge",
                "description": "Make high-value project learnings show up in the shared knowledge system.",
                "status": "open",
                "progress_percent": 20,
                "status_summary": "The retrieval path is working, but writing back is inconsistent.",
                "key_results": ["5 reusable docs promoted", "Knowledge review queue active"],
            },
        ],
        "channels": [
            {
                "name": "Handbook restructuring",
                "messages": [
                    ("You", "We have too many pages that describe the same operating pattern."),
                    ("Iris", "Agreed. The first pass should merge by user task, not by team boundary."),
                ],
            },
            {
                "name": "Knowledge review queue",
                "messages": [
                    ("Agent Zero", "Surfaced three candidate docs to promote into shared knowledge."),
                    ("You", "Prioritize the ones that reduce repeated support questions."),
                ],
            },
            {
                "name": "Asset reuse",
                "messages": [
                    ("Nora", "Pilot onboarding notes are valuable, but they are still trapped in project folders."),
                    ("You", "Let’s promote only the stable parts and keep the one-off context local."),
                ],
            },
        ],
        "project_messages": [
            ("You", "Knowledge should feel like a maintained system, not a pile of markdown."),
            ("Agent Zero", "Most leverage is in merging duplicate guidance and making ownership visible."),
        ],
    },
    {
        "title": "Workflow Reliability",
        "description": "Improve execution quality for key workflows and reduce manual cleanup after runs.",
        "status": "open",
        "objectives": [
            {
                "code": "R1",
                "title": "Stabilize the triage workflow",
                "description": "Reduce avoidable retries and operator interrupts.",
                "status": "in_progress",
                "progress_percent": 45,
                "status_summary": "Retry guidance helped, but the handoff copy still causes confusion.",
                "key_results": ["Retry rate under 10%", "Checkpoint copy rewritten"],
            },
            {
                "code": "R2",
                "title": "Instrument run quality",
                "description": "Capture the signals needed to spot failing patterns earlier.",
                "status": "open",
                "progress_percent": 30,
                "status_summary": "We know what to measure; dashboarding is not in place yet.",
                "key_results": ["Quality rubric agreed", "Top 3 metrics visible"],
            },
            {
                "code": "R3",
                "title": "Reduce manual post-run cleanup",
                "description": "Move common cleanup tasks into better defaults and safer automation.",
                "status": "open",
                "progress_percent": 20,
                "status_summary": "The cleanup list is documented. Prioritization is still missing.",
                "key_results": ["Cleanup backlog ranked", "2 cleanup steps automated"],
            },
            {
                "code": "R4",
                "title": "Review one failed run deeply",
                "description": "Turn a single failure into concrete product improvements.",
                "status": "done",
                "progress_percent": 100,
                "status_summary": "The review is complete and the main causes were documented.",
                "key_results": ["Failure review written", "Follow-up fixes created"],
            },
        ],
        "channels": [
            {
                "name": "Reliability review",
                "messages": [
                    ("You", "We keep fixing symptoms after runs instead of improving the defaults before runs."),
                    ("Agent Zero", "The highest leverage fix is clearer preflight context for operators."),
                ],
            },
            {
                "name": "Checkpoint wording",
                "messages": [
                    ("Mei", "Operators still misread the approval prompt."),
                    ("You", "Shorter, more action-oriented copy should reduce hesitation."),
                ],
            },
            {
                "name": "Run quality metrics",
                "messages": [
                    ("Ravi", "We can compute retry rate and operator interrupts now."),
                    ("You", "That is enough to start; we do not need a huge metrics taxonomy yet."),
                ],
            },
            {
                "name": "Cleanup backlog",
                "messages": [
                    ("Theo", "The same two manual cleanup steps show up in almost every failed run."),
                    ("You", "Let’s automate those before adding new workflow complexity."),
                ],
            },
        ],
        "project_messages": [
            ("You", "Reliability work should shrink operator effort, not just make failures easier to explain."),
            ("Agent Zero", "Current evidence points to weak defaults and inconsistent preflight context."),
        ],
    },
]


async def ensure_channel_messages(db, workspace_id, channel, messages: list[tuple[str, str]]) -> None:
    from sqlalchemy import select
    from knotwork.channels.models import ChannelMessage
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.channels.service import create_message

    existing = await db.execute(
        select(ChannelMessage.id).where(ChannelMessage.channel_id == channel.id).limit(1)
    )
    if existing.first() is not None:
        return
    for author_name, content in messages:
        await create_message(
            db,
            workspace_id=workspace_id,
            channel_id=channel.id,
            data=ChannelMessageCreate(
                role="assistant" if author_name == "Agent Zero" else "user",
                author_type="agent" if author_name == "Agent Zero" else "human",
                author_name=author_name,
                content=content,
            ),
        )


async def ensure_demo_projects(db, ws, graph) -> None:
    from sqlalchemy import select
    from knotwork.channels.models import Channel
    from knotwork.channels.schemas import ChannelCreate
    from knotwork.channels.service import create_channel
    from knotwork.projects.models import Objective, Project, ProjectStatusUpdate
    from knotwork.projects.schemas import ObjectiveCreate, ProjectCreate
    from knotwork.projects.service import create_objective, create_project

    for project_data in DEMO_PROJECTS:
        project_result = await db.execute(
            select(Project).where(Project.workspace_id == ws.id, Project.title == project_data["title"]).limit(1)
        )
        project = project_result.scalar_one_or_none()
        if project is None:
            project = await create_project(
                db,
                ws.id,
                ProjectCreate(
                    title=project_data["title"],
                    description=project_data["description"],
                    status=project_data["status"],
                ),
            )
            print(f"Created demo project: {project.title}")
        else:
            print(f"Demo project already exists: {project.title}")

        project_channel_result = await db.execute(
            select(Channel).where(Channel.project_id == project.id, Channel.channel_type == "project").limit(1)
        )
        project_channel = project_channel_result.scalar_one()
        await ensure_channel_messages(db, ws.id, project_channel, project_data.get("project_messages", []))

        status_update_result = await db.execute(
            select(ProjectStatusUpdate.id).where(ProjectStatusUpdate.project_id == project.id).limit(1)
        )
        if status_update_result.first() is None:
            db.add(
                ProjectStatusUpdate(
                    workspace_id=ws.id,
                    project_id=project.id,
                    author_type="human",
                    author_name="You",
                    summary=project_data.get("project_messages", [("You", "Project seeded.")])[0][1],
                )
            )
            await db.commit()

        objective_by_code: dict[str, Any] = {}
        for objective_data in project_data["objectives"]:
            objective_result = await db.execute(
                select(Objective).where(
                    Objective.workspace_id == ws.id,
                    Objective.project_id == project.id,
                    Objective.code == objective_data["code"],
                ).limit(1)
            )
            objective = objective_result.scalar_one_or_none()
            if objective is None:
                parent_id = None
                parent_code = objective_data.get("parent_code")
                if parent_code:
                    parent = objective_by_code.get(parent_code)
                    parent_id = parent.id if parent is not None else None
                objective = await create_objective(
                    db,
                    ws.id,
                    ObjectiveCreate(
                        code=objective_data["code"],
                        title=objective_data["title"],
                        description=objective_data["description"],
                        status=objective_data["status"],
                        progress_percent=objective_data["progress_percent"],
                        status_summary=objective_data["status_summary"],
                        key_results=objective_data["key_results"],
                        owner_name="You",
                        project_id=project.id,
                        parent_objective_id=parent_id,
                        origin_graph_id=graph.id,
                    ),
                )
                print(f"  Created objective: {objective.code} {objective.title}")
            objective_by_code[objective.code] = objective
            objective_channel_result = await db.execute(
                select(Channel).where(Channel.objective_id == objective.id, Channel.channel_type == "objective").limit(1)
            )
            objective_channel = objective_channel_result.scalar_one()
            objective_messages = [
                ("You", objective_data["status_summary"]),
                ("Agent Zero", f"Recommended next step: {objective_data['key_results'][0]}."),
            ]
            await ensure_channel_messages(db, ws.id, objective_channel, objective_messages)

        for channel_data in project_data["channels"]:
            channel_result = await db.execute(
                select(Channel).where(
                    Channel.workspace_id == ws.id,
                    Channel.project_id == project.id,
                    Channel.channel_type == "normal",
                    Channel.name == channel_data["name"],
                ).limit(1)
            )
            channel = channel_result.scalar_one_or_none()
            if channel is None:
                channel = await create_channel(
                    db,
                    ws.id,
                    ChannelCreate(
                        name=channel_data["name"],
                        channel_type="normal",
                        project_id=project.id,
                    ),
                )
                print(f"  Created channel: {channel.name}")
            await ensure_channel_messages(db, ws.id, channel, channel_data["messages"])


async def main() -> None:
    # Import all models so FK resolution works
    import knotwork.auth.models          # noqa: F401
    import knotwork.workspaces.models    # noqa: F401
    import knotwork.graphs.models        # noqa: F401
    import knotwork.channels.models      # noqa: F401
    import knotwork.runs.models          # noqa: F401
    import knotwork.knowledge.models     # noqa: F401
    import knotwork.tools.models         # noqa: F401
    import knotwork.escalations.models   # noqa: F401
    import knotwork.ratings.models       # noqa: F401
    import knotwork.audit.models         # noqa: F401

    from sqlalchemy import select
    from knotwork.database import AsyncSessionLocal
    from knotwork.workspaces.models import Workspace
    from knotwork.graphs.models import Graph, GraphVersion
    from knotwork.utils.namegen import generate_name

    async with AsyncSessionLocal() as db:
        # Workspace
        result = await db.execute(select(Workspace).limit(1))
        ws = result.scalar_one_or_none()
        if ws is None:
            ws = Workspace(name="Dev Workspace", slug="dev")
            db.add(ws)
            await db.commit()
            await db.refresh(ws)
            print(f"Created workspace: {ws.id}")
        else:
            print(f"Using existing workspace: {ws.id}")

        # Demo graph
        result = await db.execute(
            select(Graph).where(Graph.workspace_id == ws.id).limit(1)
        )
        graph = result.scalar_one_or_none()
        if graph is None:
            graph = Graph(workspace_id=ws.id, name="Demo — Analyse & Review", path="building")
            db.add(graph)
            await db.flush()
            version = GraphVersion(graph_id=graph.id, definition=DEMO_GRAPH, version_name=generate_name())
            db.add(version)
            await db.commit()
            await db.refresh(graph)
            print(f"Created demo graph: {graph.id}")
        else:
            print(f"Demo graph already exists: {graph.id}")

        await ensure_demo_projects(db, ws, graph)

    # Upsert VITE_DEV_WORKSPACE_ID in the root .env so both Vite and pydantic-settings
    # pick it up. We only write/update this one key and leave everything else intact.
    root_env = ROOT / ".env"
    key = "VITE_DEV_WORKSPACE_ID"
    value = str(ws.id)
    if root_env.exists():
        lines = root_env.read_text().splitlines(keepends=True)
        found = False
        new_lines = []
        for line in lines:
            if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
                new_lines.append(f"{key}={value}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{key}={value}\n")
        root_env.write_text("".join(new_lines))
    else:
        root_env.write_text(f"{key}={value}\n")
    print(f"Updated {root_env} with {key}={value}")


asyncio.run(main())
