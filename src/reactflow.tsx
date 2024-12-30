import * as Dagre from '@dagrejs/dagre'
import { useCallback, useEffect } from 'react'
import {
    // types
    type Node,
    type Edge,
    type NodeProps,
    type NodeMouseHandler,
    // hooks
    useNodesState,
    useEdgesState,
    useReactFlow,
    useNodesInitialized,
    // components
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    Panel,
    Controls,
    Background,
    BackgroundVariant,
} from '@xyflow/react'
import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
// import 'katex/dist/katex.min.css'
// import '@xyflow/react/dist/style.css'

// options
const FITVIEW_OPT = {
    duration: 1000,
    padding: 0.3,
    minZoom: 0.001,
}

const BG_OPT = {
    variant: BackgroundVariant.Dots,
    gap: 12,
    size: 1,
}

// layout method
const getLayoutedElements = (nodes: Node[], edges: Edge[], options: Record<string, any>) => {
    // init dagre graph
    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: options.direction })

    // add edges & nodes
    edges.forEach((edge: Edge) => g.setEdge(edge.source, edge.target))
    nodes.forEach((node: Node) =>
        g.setNode(node.id, {
            ...node,
            width: node.measured?.width ?? 0,
            height: node.measured?.height ?? 0,
        }),
    )

    // layout and return
    Dagre.layout(g)
   
    return {
        nodes: nodes.map((node: Node) => {
            const position = g.node(node.id)
            // shift the dagre node position (anchor=center center) to the top left
            // so it matches the React Flow node anchor point (top left).
            const x = position.x - (node.measured?.width ?? 0) / 2
            const y = position.y - (node.measured?.height ?? 0) / 2
            return { ...node, position: { x, y } }
        }),
        edges,
    }
}

// node type
export type NoteNode = Node<NoteData, 'note'>;
 
export type NoteData = {
    source: string;
}

const HANDLE_STYLE = {
}

export function Note({ data }: NodeProps<NoteNode>) {
	return (
        <div className="text-updater-node nowheel">
            <Handle
                type="target"
                position={Position.Top}
                style={HANDLE_STYLE}
            />
            <Handle
                type="source"
                position={Position.Bottom}
                id="a"
            />
            <div>
                <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{data.source}</Markdown>
            </div>
    </div>
	)
}

const nodeTypes = {
	note: Note,
}

// customized flow with layout
export interface LayoutFlowProps {
    nodes: Array<Node>
    edges: Array<Edge>
}

const LayoutFlow = (props: LayoutFlowProps) => {
    const { fitView } = useReactFlow()
    const [nodes, setNodes, onNodesChange] = useNodesState(props.nodes)
    const [edges, setEdges, onEdgesChange] = useEdgesState(props.edges)
    const nodesInitialized = useNodesInitialized()
   
    // layout callbacks
    const onFitview = useCallback(
        () => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    fitView(FITVIEW_OPT)
                })
            })
        },
        []
    )

    const onLayout = useCallback(
        (direction: string) => {
            const layouted = getLayoutedElements(nodes, edges, { direction })
            setNodes([...layouted.nodes])
            setEdges([...layouted.edges])
            onFitview()
        },
        [nodes, edges],
    )

    const handleNodeClick = useCallback<NodeMouseHandler>(
        (_, node) => {
          fitView({ nodes: [node], duration: 1000 })
        },
        [],
        // [fitView],
    )

    // auto layout after nodes initialized
    useEffect(() => {
        if (nodesInitialized) {
            setTimeout(() => {
                onLayout('TB')
                onFitview()
            }, 10)
        }
    }, [nodesInitialized])

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            panOnScroll
        >
            <Panel position="top-right">
                <button onClick={() => onLayout('TB')}>vertical layout</button>
                <button onClick={() => onLayout('LR')}>horizontal layout</button>
            </Panel>
            <Controls position="top-left" fitViewOptions={FITVIEW_OPT}/>
            <Background  {...BG_OPT}/>
            </ReactFlow>
    )
}

// export component
export const FlowView = (props: LayoutFlowProps) => {
    return (
        <ReactFlowProvider>
            <div style={{ width: '100%', height: '90vh' }}>
                <LayoutFlow {...props}/>
            </div>
        </ReactFlowProvider>
    )
}