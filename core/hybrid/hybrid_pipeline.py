"""Hybrid Workflow + Scoped Agent pipeline utilities."""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict, Optional

_DEFAULT_FALLBACK = (
    "Hybrid systems blend deterministic workflows with scoped agents to pair "
    "predictable execution with exploratory problem solving."
)


def _fallback_pipeline(reason: str) -> Callable[[str], str]:
    """Return a trivial pipeline that explains why the hybrid system is unavailable."""

    def _inner(query: str) -> str:
        return (
            "Hybrid pipeline fallback response.\n"
            f"Query: {query}\n"
            f"Reason: {reason}\n"
            f"Summary: {_DEFAULT_FALLBACK}"
        )

    return _inner


try:  # pragma: no cover - guarded imports only validated at runtime
    from langchain.chat_models import init_chat_model
    from langchain.chains import create_retrieval_chain
    from langchain.chains.combine_documents import create_stuff_documents_chain
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_community.vectorstores.faiss import FAISS
    from langchain_openai import OpenAIEmbeddings
    from langgraph.prebuilt import create_react_agent
    from langchain_community.tools.tavily_search import TavilySearchResults
    try:
        from langchain_community.embeddings import FakeEmbeddings
    except Exception:  # pragma: no cover - optional helper
        FakeEmbeddings = None  # type: ignore
except Exception as exc:  # pragma: no cover - if imports fail provide fallback pipeline
    init_chat_model = None  # type: ignore
    create_retrieval_chain = None  # type: ignore
    create_stuff_documents_chain = None  # type: ignore
    ChatPromptTemplate = None  # type: ignore
    FAISS = None  # type: ignore
    OpenAIEmbeddings = None  # type: ignore
    create_react_agent = None  # type: ignore
    TavilySearchResults = None  # type: ignore
    FakeEmbeddings = None  # type: ignore
    _IMPORT_ERROR: Optional[Exception] = exc
else:
    _IMPORT_ERROR = None


def init_hybrid_system(index_path: str = "docs_index") -> Callable[[str], str]:
    """Initialise the hybrid workflow/agent pipeline.

    The function attempts to build the LangChain + LangGraph powered pipeline. If any
    dependency or configuration is missing (for example API credentials or the FAISS
    index), the function gracefully falls back to a deterministic responder so that
    upstream callers still receive a usable string output.
    """

    if _IMPORT_ERROR is not None:
        return _fallback_pipeline(f"dependency import failure: {_IMPORT_ERROR}")

    assert init_chat_model and FAISS and OpenAIEmbeddings and create_retrieval_chain
    assert create_stuff_documents_chain and ChatPromptTemplate and create_react_agent
    assert TavilySearchResults

    embeddings = None
    try:
        embeddings = OpenAIEmbeddings()
    except Exception as exc:  # pragma: no cover - depends on environment credentials
        if FakeEmbeddings is not None:
            embeddings = FakeEmbeddings(size=1536)
        else:
            return _fallback_pipeline(f"failed to initialise embeddings: {exc}")

    vector_store = None
    index_dir = Path(index_path)
    if index_dir.exists():
        try:
            vector_store = FAISS.load_local(
                str(index_dir), embeddings, allow_dangerous_deserialization=True
            )
        except Exception as exc:  # pragma: no cover - depends on runtime data
            vector_store = None
            vector_error = exc
        else:
            vector_error = None
    else:
        vector_error = None

    if vector_store is None:
        try:
            vector_store = FAISS.from_texts(
                texts=[
                    "Hybrid AI systems combine deterministic orchestration with "
                    "scoped autonomous agents to balance reliability and discovery.",
                    "Monitoring, safety and governance guardrails are essential for "
                    "production deployments of hybrid AI pipelines.",
                ],
                embedding=embeddings,
            )
        except Exception as exc:  # pragma: no cover - depends on FAISS availability
            reason = f"unable to build default FAISS index: {exc}"
            if 'vector_error' in locals() and vector_error is not None:
                reason = f"{reason}; previous load error: {vector_error}"
            return _fallback_pipeline(reason)

    retriever = vector_store.as_retriever()

    workflow_chain = None
    try:
        system_prompt = (
            "Use the given context to answer the question concisely. "
            "If the information is unavailable, respond transparently.\n\nContext: {context}"
        )
        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", system_prompt),
                ("human", "{input}"),
            ]
        )
        llm = init_chat_model("openai:gpt-4.1", temperature=0)
        document_chain = create_stuff_documents_chain(llm, prompt)
        workflow_chain = create_retrieval_chain(retriever, document_chain)
    except Exception as exc:  # pragma: no cover - external model configuration
        workflow_error = exc
    else:
        workflow_error = None

    agent_executor = None
    try:
        search_tool = TavilySearchResults(max_results=2)
        agent_llm = init_chat_model("anthropic:claude-3-7-sonnet-latest", temperature=0)
        agent_executor = create_react_agent(model=agent_llm, tools=[search_tool])
    except Exception as exc:  # pragma: no cover - external model configuration
        agent_error = exc
    else:
        agent_error = None

    def is_uncertain(answer: str) -> bool:
        uncertain_markers = [
            "i don't know",
            "unclear",
            "insufficient",
            "cannot determine",
            "no relevant documents",
        ]
        lowered = answer.lower()
        return any(marker in lowered for marker in uncertain_markers)

    def build_agent_response(query: str) -> str:
        if agent_executor is None:
            agent_reason = f"agent unavailable: {agent_error}" if agent_error else "agent disabled"
            return (
                f"Fallback agent response. Query: {query}. Reason: {agent_reason}. "
                f"Summary: {_DEFAULT_FALLBACK}"
            )
        try:
            agent_result: Dict[str, object] = agent_executor.invoke(
                {"messages": [{"role": "user", "content": query}]}
            )
            messages = agent_result.get("messages") if isinstance(agent_result, dict) else None
            if isinstance(messages, list) and messages:
                final_message = messages[-1]
                if isinstance(final_message, dict) and "content" in final_message:
                    return str(final_message["content"])
        except Exception as exc:  # pragma: no cover - runtime tool errors
            return (
                f"Agent invocation failed: {exc}. Query: {query}. "
                f"Summary: {_DEFAULT_FALLBACK}"
            )
        return f"Agent completed without structured response. Query: {query}."

    if workflow_chain is None:
        fallback_reason = f"workflow unavailable: {workflow_error}" if workflow_error else "workflow disabled"
        return _fallback_pipeline(fallback_reason)

    def hybrid_pipeline(query: str) -> str:
        try:
            rag_out = workflow_chain.invoke({"input": query})
        except Exception as exc:  # pragma: no cover - runtime LLM/tool issues
            return (
                f"Workflow execution failed: {exc}. Query: {query}. "
                f"Summary: {_DEFAULT_FALLBACK}"
            )

        answer = ""
        if isinstance(rag_out, dict):
            answer = str(rag_out.get("answer", ""))
        else:
            answer = str(rag_out)

        if not answer or is_uncertain(answer):
            return build_agent_response(query)

        return answer

    return hybrid_pipeline
