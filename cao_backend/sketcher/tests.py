"""
Tests for sketcher constraint solver and views
"""

import pytest
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status

from cao_core.models import Project, Sketch
from sketcher.services import SketchConstraintSolver


@pytest.mark.django_db
class TestSketchConstraintSolver:
    """Test suite for SketchConstraintSolver"""

    def test_solver_initialization(self):
        """Test that solver initializes correctly"""
        solver = SketchConstraintSolver()
        assert solver.points == {}
        assert solver.lines == {}
        assert solver.circles == {}
        assert len(solver.error_log) == 0

    def test_add_point(self):
        """Test adding points to sketch"""
        solver = SketchConstraintSolver()
        point = solver.add_point("p1", 10.0, 20.0)
        
        assert point is not None
        assert point.name == "p1"
        assert "p1" in solver.points

    def test_add_multiple_points(self):
        """Test adding multiple points"""
        solver = SketchConstraintSolver()
        p1 = solver.add_point("p1", 0.0, 0.0)
        p2 = solver.add_point("p2", 10.0, 0.0)
        p3 = solver.add_point("p3", 10.0, 10.0)
        
        assert len(solver.points) == 3
        assert "p1" in solver.points
        assert "p2" in solver.points
        assert "p3" in solver.points

    def test_add_line(self):
        """Test adding a line between two points"""
        solver = SketchConstraintSolver()
        p1 = solver.add_point("p1", 0.0, 0.0)
        p2 = solver.add_point("p2", 10.0, 0.0)
        line = solver.add_line("line1", "p1", "p2")
        
        assert line is not None
        assert line.name == "line1"
        assert "line1" in solver.lines

    def test_add_line_with_missing_point(self):
        """Test adding a line with missing endpoint"""
        solver = SketchConstraintSolver()
        solver.add_point("p1", 0.0, 0.0)
        line = solver.add_line("line1", "p1", "p_missing")
        
        assert line is None
        assert len(solver.error_log) > 0

    def test_add_circle(self):
        """Test adding a circle to sketch"""
        solver = SketchConstraintSolver()
        center = solver.add_point("center", 5.0, 5.0)
        circle = solver.add_circle("circle1", "center", 3.0)
        
        assert circle is not None
        assert circle.name == "circle1"
        assert "circle1" in solver.circles

    def test_constrain_horizontal(self):
        """Test horizontal line constraint"""
        solver = SketchConstraintSolver()
        p1 = solver.add_point("p1", 0.0, 0.0)
        p2 = solver.add_point("p2", 10.0, 0.0)
        line = solver.add_line("line1", "p1", "p2")
        
        result = solver.constrain_horizontal("line1")
        assert result is True
        assert "horizontal(line1)" in solver.constraints_applied

    def test_constrain_vertical(self):
        """Test vertical line constraint"""
        solver = SketchConstraintSolver()
        p1 = solver.add_point("p1", 0.0, 0.0)
        p2 = solver.add_point("p2", 0.0, 10.0)
        line = solver.add_line("line1", "p1", "p2")
        
        result = solver.constrain_vertical("line1")
        assert result is True
        assert "vertical(line1)" in solver.constraints_applied

    def test_constrain_coincident_points(self):
        """Test coincident points constraint"""
        solver = SketchConstraintSolver()
        p1 = solver.add_point("p1", 0.0, 0.0)
        p2 = solver.add_point("p2", 10.0, 10.0)
        
        result = solver.constrain_coincident("p1", "p2")
        assert result is True
        assert "coincident(p1, p2)" in solver.constraints_applied

    def test_constrain_distance(self):
        """Test position constraint for a point"""
        solver = SketchConstraintSolver()
        p = solver.add_point("p1", 0.0, 0.0)
        
        result = solver.constrain_distance("p1", 5.0, 10.0)
        assert result is True
        assert "position(p1, 5.0, 10.0)" in solver.constraints_applied

    def test_validate_empty_sketch(self):
        """Test validation of empty sketch"""
        solver = SketchConstraintSolver()
        
        is_valid, errors = solver.validate_sketch()
        assert is_valid is False
        assert len(errors) > 0

    def test_get_sketch_data(self):
        """Test exporting sketch data"""
        solver = SketchConstraintSolver()
        p1 = solver.add_point("p1", 0.0, 0.0)
        p2 = solver.add_point("p2", 10.0, 0.0)
        line = solver.add_line("line1", "p1", "p2")
        
        data = solver.get_sketch_data()
        assert "points" in data
        assert "lines" in data
        assert "circles" in data
        assert "constraints" in data
        assert "valid" in data
        assert "errors" in data

    def test_is_closed_profile_empty(self):
        """Test closed profile check on empty sketch"""
        solver = SketchConstraintSolver()
        
        assert solver.is_closed_profile() is False

    def test_reset_solver(self):
        """Test resetting solver state"""
        solver = SketchConstraintSolver()
        solver.add_point("p1", 0.0, 0.0)
        solver.add_point("p2", 10.0, 0.0)
        
        assert len(solver.points) == 2
        
        solver.reset()
        assert len(solver.points) == 0
        assert len(solver.lines) == 0
        assert len(solver.error_log) == 0


@pytest.mark.django_db
class TestValidateSketchView:
    """Test sketch validation API endpoint"""

    def setup_method(self):
        """Set up test data"""
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='testuser',
            password='testpass123'
        )
        self.client.force_authenticate(user=self.user)

    def test_validate_sketch_missing_data(self):
        """Test validation with missing sketch data"""
        response = self.client.post('/api/sketcher/validate/', {})
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]

    def test_validate_sketch_empty(self):
        """Test validation of empty sketch"""
        response = self.client.post('/api/sketcher/validate/', {'sketch_data': {}}, format='json')
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_422_UNPROCESSABLE_ENTITY]


@pytest.mark.django_db
class TestSolveConstraintsView:
    """Test constraint solver API endpoint"""

    def setup_method(self):
        """Set up test data"""
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='testuser',
            password='testpass123'
        )
        self.client.force_authenticate(user=self.user)

    def test_solve_constraints_missing_data(self):
        """Test solving with missing sketch data"""
        response = self.client.post('/api/sketcher/solve-constraints/', {})
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]

    def test_solve_constraints_empty(self):
        """Test solving constraints on empty sketch"""
        response = self.client.post('/api/sketcher/solve-constraints/', 
            {
                'sketch_data': {},
                'constraints': []
            },
            format='json'
        )
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_422_UNPROCESSABLE_ENTITY]
