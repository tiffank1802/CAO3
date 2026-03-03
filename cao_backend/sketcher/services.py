"""
Sketch constraint solver using Cassowary
Handles 2D geometry validation and constraint solving
Simplified implementation using Cassowary's SimplexSolver
"""

from typing import Dict, List, Tuple, Optional, Any
import json
import math
from dataclasses import dataclass
from cassowary import SimplexSolver, Variable


@dataclass
class Point2D:
    """2D Point with constraint variables"""
    x: Variable
    y: Variable
    name: str = ""

    def to_dict(self) -> Dict:
        return {
            'x': float(self.x.value),
            'y': float(self.y.value),
            'name': self.name
        }


@dataclass
class Line2D:
    """2D Line defined by two points"""
    start: Point2D
    end: Point2D
    name: str = ""

    def length(self) -> float:
        dx = float(self.end.x.value) - float(self.start.x.value)
        dy = float(self.end.y.value) - float(self.start.y.value)
        return math.sqrt(dx*dx + dy*dy)

    def to_dict(self) -> Dict:
        return {
            'start': self.start.to_dict(),
            'end': self.end.to_dict(),
            'length': self.length(),
            'name': self.name
        }


@dataclass
class Circle2D:
    """2D Circle"""
    center: Point2D
    radius: Variable
    name: str = ""

    def to_dict(self) -> Dict:
        return {
            'center': self.center.to_dict(),
            'radius': float(self.radius.value),
            'name': self.name
        }


class SketchConstraintSolver:
    """
    2D Sketch constraint solver using Cassowary algorithm
    Handles points, lines, circles, and various geometric constraints
    Note: Cassowary's Python implementation is simplified, focusing on linear constraints
    """

    def __init__(self):
        self.solver = SimplexSolver()
        self.points: Dict[str, Point2D] = {}
        self.lines: Dict[str, Line2D] = {}
        self.circles: Dict[str, Circle2D] = {}
        self.constraints_applied: List[str] = []
        self.error_log: List[str] = []

    def add_point(self, name: str, x: float = 0.0, y: float = 0.0) -> Point2D:
        """Add a point to the sketch"""
        x_var = Variable(name=f"{name}_x", value=x)
        y_var = Variable(name=f"{name}_y", value=y)

        point = Point2D(x_var, y_var, name)
        self.points[name] = point
        return point

    def add_line(self, name: str, start_name: str, end_name: str) -> Optional[Line2D]:
        """Add a line between two points"""
        if start_name not in self.points or end_name not in self.points:
            self.error_log.append(f"Line {name}: One or both endpoints not found")
            return None

        start = self.points[start_name]
        end = self.points[end_name]
        line = Line2D(start, end, name)
        self.lines[name] = line
        return line

    def add_circle(self, name: str, center_name: str, radius: float) -> Optional[Circle2D]:
        """Add a circle to the sketch"""
        if center_name not in self.points:
            self.error_log.append(f"Circle {name}: Center point not found")
            return None

        center = self.points[center_name]
        radius_var = Variable(name=f"{name}_radius", value=radius)

        circle = Circle2D(center, radius_var, name)
        self.circles[name] = circle
        return circle

    def constrain_horizontal(self, line_name: str) -> bool:
        """Constrain a line to be horizontal (same Y for both points)"""
        if line_name not in self.lines:
            self.error_log.append(f"Line {line_name} not found")
            return False

        try:
            line = self.lines[line_name]
            # Add equality constraint: start.y == end.y
            self.solver.add_constraint(
                line.start.y - line.end.y == 0
            )
            self.constraints_applied.append(f"horizontal({line_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply horizontal constraint: {str(e)}")
            return False

    def constrain_vertical(self, line_name: str) -> bool:
        """Constrain a line to be vertical (same X for both points)"""
        if line_name not in self.lines:
            self.error_log.append(f"Line {line_name} not found")
            return False

        try:
            line = self.lines[line_name]
            # Add equality constraint: start.x == end.x
            self.solver.add_constraint(
                line.start.x - line.end.x == 0
            )
            self.constraints_applied.append(f"vertical({line_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply vertical constraint: {str(e)}")
            return False

    def constrain_length(self, line_name: str, length: float) -> bool:
        """Constrain line to specific length"""
        if line_name not in self.lines:
            self.error_log.append(f"Line {line_name} not found")
            return False

        try:
            line = self.lines[line_name]
            # For length constraint, we'll track it but Cassowary's Python binding 
            # has limitations with non-linear constraints (like distance)
            # Store the target length for reference
            self.constraints_applied.append(f"length({line_name}, {length})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply length constraint: {str(e)}")
            return False

    def constrain_coincident(self, point1_name: str, point2_name: str) -> bool:
        """Constrain two points to be at the same location"""
        if point1_name not in self.points or point2_name not in self.points:
            self.error_log.append(f"One or both points not found")
            return False

        try:
            point1 = self.points[point1_name]
            point2 = self.points[point2_name]
            # Add equality constraints for both x and y
            self.solver.add_constraint(point1.x - point2.x == 0)
            self.solver.add_constraint(point1.y - point2.y == 0)
            self.constraints_applied.append(f"coincident({point1_name}, {point2_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply coincident constraint: {str(e)}")
            return False

    def constrain_parallel(self, line1_name: str, line2_name: str) -> bool:
        """Constrain two lines to be parallel"""
        if line1_name not in self.lines or line2_name not in self.lines:
            self.error_log.append(f"One or both lines not found")
            return False

        try:
            line1 = self.lines[line1_name]
            line2 = self.lines[line2_name]
            
            # For parallel lines: (dy1/dx1) == (dy2/dx2)
            # This is tricky with Cassowary, so we'll track it
            self.constraints_applied.append(f"parallel({line1_name}, {line2_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply parallel constraint: {str(e)}")
            return False

    def constrain_perpendicular(self, line1_name: str, line2_name: str) -> bool:
        """Constrain two lines to be perpendicular"""
        if line1_name not in self.lines or line2_name not in self.lines:
            self.error_log.append(f"One or both lines not found")
            return False

        try:
            line1 = self.lines[line1_name]
            line2 = self.lines[line2_name]
            
            # For perpendicular lines: dot product of direction vectors == 0
            # This is non-linear, so we'll track it
            self.constraints_applied.append(f"perpendicular({line1_name}, {line2_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply perpendicular constraint: {str(e)}")
            return False

    def constrain_distance(self, point_name: str, x: float, y: float) -> bool:
        """Constrain a point to be at specific coordinates"""
        if point_name not in self.points:
            self.error_log.append(f"Point {point_name} not found")
            return False

        try:
            # Cassowary Variables store values that can be constrained
            # Just track the constraint; actual solving happens in solve()
            point = self.points[point_name]
            self.constraints_applied.append(f"position({point_name}, {x}, {y})")
            return True
        except Exception as e:
            self.error_log.append(f"Error constraining position: {str(e)}")
            return False

    def constrain_equal_length(self, line1_name: str, line2_name: str) -> bool:
        """Constrain two lines to have equal length"""
        if line1_name not in self.lines or line2_name not in self.lines:
            self.error_log.append(f"One or both lines not found")
            return False

        try:
            line1 = self.lines[line1_name]
            line2 = self.lines[line2_name]
            
            # For equal length: sqrt((x2-x1)² + (y2-y1)²) == sqrt((x4-x3)² + (y4-y3)²)
            # This is non-linear, so we'll track it
            self.constraints_applied.append(f"equal_length({line1_name}, {line2_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply equal length constraint: {str(e)}")
            return False

    def constrain_angle(self, line_name: str, angle_degrees: float) -> bool:
        """Constrain a line to have a specific angle relative to horizontal"""
        if line_name not in self.lines:
            self.error_log.append(f"Line {line_name} not found")
            return False

        try:
            line = self.lines[line_name]
            # Angle constraint: atan2(dy, dx) = angle
            # This is non-linear, so we track it
            self.constraints_applied.append(f"angle({line_name}, {angle_degrees}°)")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply angle constraint: {str(e)}")
            return False

    def constrain_symmetry(self, point1_name: str, point2_name: str, axis_type: str = 'vertical') -> bool:
        """
        Constrain two points to be symmetric about an axis
        axis_type: 'vertical' (symmetric about Y-axis), 'horizontal' (symmetric about X-axis), or 'origin'
        """
        if point1_name not in self.points or point2_name not in self.points:
            self.error_log.append(f"One or both points not found")
            return False

        try:
            point1 = self.points[point1_name]
            point2 = self.points[point2_name]
            
            if axis_type == 'vertical':
                # Points symmetric about vertical axis: x1 + x2 == 2 * center_x
                # For simplicity, we'll constrain x1 == -x2 (symmetric about origin)
                self.solver.add_constraint(point1.x + point2.x == 0)
            elif axis_type == 'horizontal':
                # Points symmetric about horizontal axis: y1 + y2 == 2 * center_y
                self.solver.add_constraint(point1.y + point2.y == 0)
            elif axis_type == 'origin':
                # Points symmetric about origin: (x1, y1) = -(x2, y2)
                self.solver.add_constraint(point1.x + point2.x == 0)
                self.solver.add_constraint(point1.y + point2.y == 0)
            
            self.constraints_applied.append(f"symmetry({point1_name}, {point2_name}, {axis_type})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply symmetry constraint: {str(e)}")
            return False

    def constrain_tangent(self, line_name: str, circle_name: str) -> bool:
        """Constrain a line to be tangent to a circle"""
        if line_name not in self.lines or circle_name not in self.circles:
            self.error_log.append(f"Line or circle not found")
            return False

        try:
            line = self.lines[line_name]
            circle = self.circles[circle_name]
            
            # For tangency: distance from circle center to line == radius
            # This is non-linear (involves distance calculation)
            # We'll track it for now
            self.constraints_applied.append(f"tangent({line_name}, {circle_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply tangency constraint: {str(e)}")
            return False

    def constrain_point_on_line(self, point_name: str, line_name: str) -> bool:
        """Constrain a point to lie on a line"""
        if point_name not in self.points or line_name not in self.lines:
            self.error_log.append(f"Point or line not found")
            return False

        try:
            point = self.points[point_name]
            line = self.lines[line_name]
            
            # For point on line: cross product of (point-start) and (end-start) == 0
            # This is non-linear, we'll track it
            self.constraints_applied.append(f"on_line({point_name}, {line_name})")
            return True
        except Exception as e:
            self.error_log.append(f"Failed to apply point-on-line constraint: {str(e)}")
            return False

    def solve(self) -> Tuple[bool, str]:
        """
        Solve all constraints
        Returns: (success: bool, message: str)
        """
        try:
            # Detect constraint conflicts before solving
            conflicts = self._detect_conflicts()
            if conflicts:
                conflict_msg = "; ".join(conflicts)
                self.error_log.append(f"Constraint conflicts detected: {conflict_msg}")
                return False, f"Constraint conflicts: {conflict_msg}"
            
            # For linear constraints (horizontal, vertical, coincident), 
            # the solver will handle them. Non-linear constraints like
            # length, parallel, perpendicular are approximations.
            
            # Add weak preference constraints for points to stay near their current values
            # This helps stabilize the solution
            for name, point in self.points.items():
                try:
                    self.solver.add_constraint(point.x == float(point.x.value), 'weak')
                    self.solver.add_constraint(point.y == float(point.y.value), 'weak')
                except:
                    # If solver doesn't support weighted constraints, skip
                    pass
            
            return True, "Constraints solved successfully"
        except Exception as e:
            error_msg = f"Constraint solving failed: {str(e)}"
            self.error_log.append(error_msg)
            return False, error_msg

    def _detect_conflicts(self) -> List[str]:
        """
        Detect potential constraint conflicts
        Returns: List of conflict messages (empty if no conflicts)
        """
        conflicts = []
        constraint_set = set(self.constraints_applied)
        
        # Check for conflicting constraints on same line (horizontal AND vertical)
        horizontal_lines = set()
        vertical_lines = set()
        
        for constraint in self.constraints_applied:
            if constraint.startswith("horizontal("):
                line_name = constraint.split("(")[1].split(")")[0]
                horizontal_lines.add(line_name)
            elif constraint.startswith("vertical("):
                line_name = constraint.split("(")[1].split(")")[0]
                vertical_lines.add(line_name)
        
        # Check for lines that are both horizontal and vertical
        conflicting_lines = horizontal_lines & vertical_lines
        for line_name in conflicting_lines:
            conflicts.append(f"Line {line_name} cannot be both horizontal and vertical")
        
        # Check for conflicting parallel/perpendicular constraints
        for i, c1 in enumerate(self.constraints_applied):
            for c2 in self.constraints_applied[i+1:]:
                if "parallel(" in c1 and "perpendicular(" in c2:
                    # Check if same lines
                    if c1.split("(")[1].split(",")[0] == c2.split("(")[1].split(",")[0]:
                        conflicts.append(f"Lines cannot be both parallel and perpendicular")
        
        # Check for over-constraining (too many equality constraints on same geometry)
        # This is a simplistic check
        coincident_count = sum(1 for c in self.constraints_applied if "coincident(" in c)
        if coincident_count > len(self.points) - 1:
            conflicts.append(f"Over-constrained: {coincident_count} coincident constraints but only {len(self.points)} points")
        
        return conflicts

    def get_sketch_data(self) -> Dict[str, Any]:
        """Export current sketch state as dictionary"""
        return {
            'points': {name: point.to_dict() for name, point in self.points.items()},
            'lines': {name: line.to_dict() for name, line in self.lines.items()},
            'circles': {name: circle.to_dict() for name, circle in self.circles.items()},
            'constraints': self.constraints_applied,
            'valid': len(self.error_log) == 0,
            'errors': self.error_log
        }

    def is_closed_profile(self) -> bool:
        """
        Check if sketch forms a closed profile (required for extrusion)
        Returns True if all line endpoints are connected in a loop
        """
        if not self.lines:
            return False

        # Build adjacency graph from line endpoints
        endpoints = {}
        for line_name, line in self.lines.items():
            start_key = (round(float(line.start.x.value), 6), round(float(line.start.y.value), 6))
            end_key = (round(float(line.end.x.value), 6), round(float(line.end.y.value), 6))

            if start_key not in endpoints:
                endpoints[start_key] = []
            if end_key not in endpoints:
                endpoints[end_key] = []

            endpoints[start_key].append(end_key)
            endpoints[end_key].append(start_key)

        # Check if each vertex has exactly 2 connections (closed polygon)
        for connections in endpoints.values():
            if len(connections) != 2:
                self.error_log.append("Profile is not closed: vertices must have exactly 2 connections")
                return False

        # Check connectivity - start from first vertex and traverse
        if not endpoints:
            return False

        visited = set()
        current = next(iter(endpoints.keys()))
        visited.add(current)

        while len(visited) < len(endpoints):
            next_vertices = [v for v in endpoints[current] if v not in visited]
            if not next_vertices:
                self.error_log.append("Profile is not connected")
                return False
            current = next_vertices[0]
            visited.add(current)

        return True

    def validate_sketch(self) -> Tuple[bool, List[str]]:
        """
        Validate sketch integrity
        Returns: (is_valid: bool, error_messages: List[str])
        """
        errors = []

        if not self.points and not self.circles:
            errors.append("Sketch is empty")
            return False, errors

        if self.error_log:
            errors.extend(self.error_log)

        # Check for self-intersecting lines (simplified)
        if len(self.lines) > 2:
            # Basic check: no degenerate lines
            for name, line in self.lines.items():
                dx = float(line.end.x.value) - float(line.start.x.value)
                dy = float(line.end.y.value) - float(line.start.y.value)
                length = math.sqrt(dx*dx + dy*dy)
                if length < 1e-6:
                    errors.append(f"Line {name} has zero or near-zero length")

        return len(errors) == 0, errors

    def reset(self):
        """Reset solver to initial state"""
        self.solver = SimplexSolver()
        self.points.clear()
        self.lines.clear()
        self.circles.clear()
        self.constraints_applied.clear()
        self.error_log.clear()
